import { execFileSync } from 'node:child_process';
import path from 'node:path';
import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';
import type { LocalConfig, RegisteredRepo, ResolvedPaths } from '../core/config.js';
import type { KnowledgeRecord } from '../core/types.js';
import { openIndex } from '../indexing/database.js';
import { parse } from 'yaml';
import { DomainError } from '../capture/candidate-store.js';
import { provenance, type KnowledgeSnapshotMetadata, type CheckoutDrift } from '../indexing/provenance.js';
import { createHash } from 'node:crypto';
import { publishedVisible, scopeAllowed, projectRecord, projectBody, hasApproval } from './visibility.js';
import { readConflictReferences, type ConflictReference } from '../capture/conflicts.js';
import type { PolicyIssue } from './policy-contracts.js';
import { rankMatch, ftsAlternatives, type RankingSignals } from './ranking.js';
import { readOptions, type ReadOptions, measured, limits, fits, budgetError, snapshot, continuation, offsetFor, checkGeneration, utf8End } from './budget.js';

interface StoredRecord { id: string; title: string; summary: string; type: string; scope_kind: string; scope_json: string; status: string; body: string; content_hash: string }
export interface KnowledgeSummary { id: string; title: string; summary: string; type: string; scope: unknown; matched_reasons: string[]; evidence: unknown[]; freshness: string; relationships: Array<{ type: string; target: string }>; editorial_status: string; normative: boolean; requires_review: boolean }
export interface ContextBundle { status: 'ok' | 'CONTEXT_BUDGET_EXCEEDED' | 'POLICY_REVIEW_REQUIRED'; knowledge_revision: string; index_generation: string; knowledge_snapshot: KnowledgeSnapshotMetadata; checkout_drift: CheckoutDrift; application_source: { repo_id: string; requested_revision: string | null } | null; results: KnowledgeSummary[]; truncated: boolean; estimated_tokens: number; estimator_name: string; unresolved_conflicts: string[]; conflicts: ConflictReference[]; policy_issues: PolicyIssue[]; omitted_conflict_count: number; omitted_result_count: number; omitted_mandatory_ids?: string[] }
type Item = { stored: StoredRecord; record: KnowledgeRecord };
type Access = { target?: RegisteredRepo; records: Item[]; all: Item[]; readableIds: Set<string> };

function controls(options: ReadOptions): ReadOptions {
  const result = readOptions.safeParse(options);
  if (!result.success) throw new DomainError('VALIDATION_ERROR', 'Invalid retrieval controls.');
  return result.data;
}

function integer(value: number | undefined, minimum = 1): void {
  if (value !== undefined && (!Number.isSafeInteger(value) || value < minimum)) throw new DomainError('VALIDATION_ERROR', 'Invalid retrieval limit.');
}

function decodeRecord(row: Record<string, SQLOutputValue> | undefined): StoredRecord | undefined {
  if (!row) return undefined;
  return { id: String(row.id), title: String(row.title), summary: String(row.summary), type: String(row.type), scope_kind: String(row.scope_kind), scope_json: String(row.scope_json), status: String(row.status), body: String(row.body), content_hash: String(row.content_hash) };
}

function readRecord(database: DatabaseSync, id: string): StoredRecord | undefined {
  return decodeRecord(database.prepare('SELECT * FROM records WHERE id = ?').get(id));
}

function parsedRecord(stored: StoredRecord): KnowledgeRecord {
  const separator = stored.body.replace(/\r\n/g, '\n').indexOf('\n---', 4);
  const header = stored.body.replace(/\r\n/g, '\n').slice(4, separator);
  return parse(header, { uniqueKeys: true, schema: 'core' }) as KnowledgeRecord;
}

function localRepo(config: LocalConfig, repoId?: string): RegisteredRepo | undefined {
  if (!repoId) return undefined;
  return config.repositories.find((repo) => repo.id === repoId || repo.aliases.includes(repoId));
}

function git(repo: RegisteredRepo, args: string[]): string {
  return execFileSync('git', ['-C', repo.path, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

function sourceFreshness(record: KnowledgeRecord, config: LocalConfig, sourceRevision?: string, sourceRepoId?: string): string {
  let sawCode = false;
  let unchecked = !sourceRevision;
  for (const raw of record.sources) {
    if (raw.kind === 'test') return 'unknown'; // Test result artifacts are not verified by this local feature.
    if (raw.kind !== 'code') continue;
    sawCode = true;
    const repo = config.repositories.find((candidate) => candidate.id === raw.repo_id);
    if (!repo || typeof raw.commit !== 'string' || !/^[0-9a-f]{40}$/i.test(raw.commit) || typeof raw.path !== 'string') return 'unknown';
    const relative = raw.path.replaceAll('\\', '/');
    if (relative.startsWith('/') || relative.split('/').includes('..')) return 'unknown';
    try {
      const citedBlob = git(repo, ['rev-parse', `${raw.commit}:${relative}`]);
      if (sourceRevision && sourceRepoId === raw.repo_id) {
        const requestedBlob = git(repo, ['rev-parse', `${sourceRevision}:${relative}`]);
        if (citedBlob !== requestedBlob) return 'needs_revalidation';
        if (git(repo, ['status', '--porcelain', '--', relative])) return 'dirty_worktree';
        const currentBlob = git(repo, ['hash-object', '--', relative]);
        if (currentBlob !== requestedBlob) return 'dirty_worktree';
      } else unchecked = true;
    } catch { return 'unknown'; }
  }
  return sawCode ? (!unchecked ? 'verified_at_revision' : 'revision_not_checked') : 'not_applicable';
}

function tokenEstimate(value: unknown): number {
  return Math.ceil(Buffer.byteLength(JSON.stringify(value), 'utf8') / 3);
}

function summary(stored: StoredRecord, record: KnowledgeRecord, reason: string|string[], freshness: string, config: LocalConfig, readableIds: Set<string>, review = false): KnowledgeSummary {
  const projected = projectRecord(record, config, readableIds);
  const due = typeof record.review_after === 'string' && (!Number.isFinite(Date.parse(record.review_after)) || Date.parse(record.review_after) <= Date.now());
  const requires_review = review || record.status === 'disputed' || (record.type === 'approved-policy' && (due || !hasApproval(projected) || !['not_applicable', 'verified_at_revision'].includes(freshness)));
  return { id: stored.id, title: stored.title, summary: stored.summary, type: stored.type, scope: projected.scope, matched_reasons: typeof reason === 'string' ? [reason] : reason, evidence: projected.sources, freshness, relationships: projected.relationships, editorial_status: record.status, normative: record.type === 'approved-policy' && record.status === 'verified' && !requires_review, requires_review };
}

export class KnowledgeService {
  readonly #requestMetadata = new WeakMap<DatabaseSync, ReturnType<typeof provenance>>();
  constructor(readonly paths: ResolvedPaths) {}

  #metadata(database: DatabaseSync) { return this.#requestMetadata.get(database)!; }
  #freshness(record: KnowledgeRecord, access: Access, sourceRevision?: string): string {
    const projected = projectRecord(record, this.paths.config, access.readableIds);
    const coded = (sources: KnowledgeRecord['sources']) => sources.filter((source) => ['code', 'test'].includes(String(source.kind))).length;
    if (coded(record.sources) !== coded(projected.sources)) return 'unknown';
    return sourceFreshness(projected, this.paths.config, sourceRevision, access.target?.id);
  }
  #conflicts(access: Access): ConflictReference[] {
    const active = new Set(access.all.filter(({ record }) => record.status !== 'superseded').map(({ record }) => record.id));
    const refs = readConflictReferences(this.paths, active);
    const pairs = new Set<string>();
    for (const { record } of access.all) {
      if (!active.has(record.id)) continue;
      for (const edge of record.relationships) {
        if (edge.type !== 'contradicts' || edge.target === record.id || !active.has(edge.target)) continue;
        const ids = [record.id, edge.target].sort(); const key = JSON.stringify(ids);
        if (pairs.has(key)) continue;
        pairs.add(key); refs.push({ id: 'contradiction.' + createHash('sha256').update(key).digest('hex'), record_ids: ids, source: 'relationship' });
      }
    }
    return refs.sort((a, b) => a.id.localeCompare(b.id));
  }

  async #withIndex<T>(callback: (database: DatabaseSync) => T): Promise<T> {
    const database = await openIndex(this.paths.runtimeRoot);
    try {
      this.#requestMetadata.set(database, provenance(database, this.paths.knowledgeRoot));
      return callback(database);
    }
    catch (error) {
      if (error instanceof DomainError) throw error;
      throw new DomainError('INDEX_QUERY_FAILED', 'The knowledge query failed; check or rebuild the active index.');
    } finally { this.#requestMetadata.delete(database); database.close(); }
  }

  #rank(database: DatabaseSync, access: Access, input: RankingSignals, revision?: string) {
    const ids = access.records.map(({record}) => record.id);
    if (!ids.length) return [];
    const lexical = new Set((database.prepare(`SELECT r.id FROM record_search s JOIN records r ON r.id=s.id WHERE record_search MATCH ? AND r.id IN (${ids.map(()=>'?').join(',')}) ORDER BY r.id LIMIT 200`).all(ftsAlternatives(input),...ids) as Array<{id:string}>).map((row) => row.id));
    return access.records.map((item) => {
      const record = projectRecord(item.record,this.paths.config,access.readableIds);
      const body = lexical.has(record.id) ? item.stored.body.slice(item.stored.body.replace(/\r\n/g,'\n').indexOf('\n---',4)+4) : '';
      return {...item,...rankMatch(record,body,input)};
    }).filter((item) => item.score>0).sort((a,b)=>b.score-a.score || (a.record.id<b.record.id?-1:a.record.id>b.record.id?1:0)).slice(0,Math.min(200,this.paths.config.budgets.maxVisited)).map((item) => {
      const freshness = this.#freshness(item.record,access,revision);
      return {...item,score:item.score+(['verified_at_revision','not_applicable'].includes(freshness)?3:-3),reason:[...item.reasons,'freshness:'+freshness]};
    }).sort((a,b)=>b.score-a.score || (a.record.id<b.record.id?-1:a.record.id>b.record.id?1:0));
  }
  #readKey(database: DatabaseSync, request: unknown) { return snapshot([this.#metadata(database),this.paths.config,request]); }

  async search(query: string, repoId?: string, limit = 10, options: ReadOptions = {}) {
    integer(limit);
    options = controls(options);
    return this.#withIndex((database) => {
      const accessible = this.#accessibleSync(database, repoId);
      const conflicts = this.#conflicts(accessible);
      checkGeneration(this.#metadata(database).index_generation,options.expected_generation);
      const ranked = query.trim() ? this.#rank(database,accessible,{task:query}) : [];
      const maximum = Math.max(1,Math.min(limit,this.paths.config.budgets.maxResults));
      const key = this.#readKey(database,['search',query.trim().toLowerCase().replace(/\s+/g,' '),accessible.target?.id,maximum,conflicts,options.max_bytes,options.max_tokens]);
      const start = offsetFor(options.cursor,key,ranked.length);
      const results = ranked.slice(start,start+maximum).map(({stored,record,reason}) => summary(stored,record,reason,this.#freshness(record,accessible),this.paths.config,accessible.readableIds,conflicts.some((ref)=>ref.record_ids.includes(record.id))));
      const make = () => { const relevant = conflicts.filter((ref)=>ref.record_ids.some((id)=>results.some((result)=>result.id===id))).slice(0,12); return measured({results,unresolved_conflicts:relevant.map((ref)=>ref.id),conflicts:relevant,...this.#metadata(database),next_cursor:start+results.length<ranked.length?continuation(key,start+results.length):null,truncated:start+results.length<ranked.length,omitted_result_count:ranked.length-start-results.length}); };
      while (!fits(make(),limits(this.paths.config,options))) { if (results.length<=1) budgetError(); results.pop(); }
      return make();
    });
  }

  async get(id: string, repoId?: string, byteLimit = 8192, includeHistory = false, options: ReadOptions = {}) {
    options = controls(options);
    if (!Number.isInteger(byteLimit) || byteLimit < 1 || byteLimit > 32768 || typeof includeHistory !== 'boolean') throw new DomainError('VALIDATION_ERROR', 'Invalid direct-read options.');
    return this.#withIndex((database) => {
      if (repoId && !localRepo(this.paths.config, repoId)) throw new DomainError('NOT_FOUND', 'Repository is not registered.');
      const stored = readRecord(database, id);
      if (!stored) throw new DomainError('NOT_FOUND', 'Knowledge record not found.');
      if (!scopeAllowed(JSON.parse(stored.scope_json) as KnowledgeRecord['scope'], this.paths.config, localRepo(this.paths.config, repoId)) || !(stored.status === 'verified' || (includeHistory && ['disputed', 'superseded'].includes(stored.status)))) throw new DomainError('NOT_FOUND', 'Knowledge record not found.');
      const record = parsedRecord(stored);
      if (!publishedVisible(record, this.paths.config, localRepo(this.paths.config, repoId), includeHistory)) throw new DomainError('NOT_FOUND', 'Knowledge record not found.');
      checkGeneration(this.#metadata(database).index_generation,options.expected_generation);
      const access = this.#accessibleSync(database, repoId);
      const conflicts = this.#conflicts(access).filter((ref) => ref.record_ids.includes(id)).slice(0, 12);
      const projection = projectRecord(record, this.paths.config, access.readableIds);
      const projectedBody = projectBody(stored.body, record, projection);
      const bytes = Buffer.from(projectedBody.body, 'utf8');
      const resultRecord = summary(stored,record,'direct-lookup',this.#freshness(record,access),this.paths.config,access.readableIds,conflicts.length>0);
      const key = this.#readKey(database,['get',id,access.target?.id,byteLimit,includeHistory,conflicts,resultRecord,snapshot(projectedBody.body),options.max_bytes,options.max_tokens]);
      const start = offsetFor(options.cursor,key,bytes.length);
      if (start>0 && (bytes[start]!&0xc0)===0x80) throw new DomainError('VALIDATION_ERROR','Continuation is not a UTF-8 boundary.');
      const make = (end: number) => measured({record:resultRecord,body:bytes.subarray(start,end).toString('utf8'),redacted:projectedBody.redacted,historical:record.status!=='verified',truncated:end<bytes.length,unresolved_conflicts:conflicts.map((ref)=>ref.id),conflicts,...this.#metadata(database),next_cursor:end<bytes.length?continuation(key,end):null,body_offset:start});
      const cap = limits(this.paths.config,options);
      let low = start, high = Math.min(bytes.length,start+byteLimit);
      // Finishing removes continuation metadata, so this endpoint can fit even
      // when smaller partial pages do not. Test it before the monotonic search.
      if (high===bytes.length && fits(make(high),cap)) return make(high);
      while (low<high) { const middle = Math.ceil((low+high)/2); if (fits(make(utf8End(bytes,middle)),cap)) low=middle; else high=middle-1; }
      const end = utf8End(bytes,low);
      const result = make(end);
      if (!fits(result,cap) || (end===start && start<bytes.length)) budgetError();
      return result;
    });
  }

  async related(id: string, repoId?: string, relationTypes: string[] = [], depth = 1, limit = 12, options: ReadOptions = {}) {
    integer(limit); integer(depth, 0);
    options = controls(options);
    return this.#withIndex((database) => {
      const access = this.#accessibleSync(database, repoId);
      const conflicts = this.#conflicts(access);
      const accessible = new Map(access.records.map(({ stored, record }) => [stored.id, { stored, record }]));
      if (!accessible.has(id)) throw new DomainError('NOT_FOUND', 'Knowledge record not found.');
      checkGeneration(this.#metadata(database).index_generation,options.expected_generation);
      const maximumDepth = Math.max(0, Math.min(depth, this.paths.config.budgets.maxDepth));
      const maximumVisited = Math.min(this.paths.config.budgets.maxVisited, 50);
      const maximumResults = Math.max(1, Math.min(limit, this.paths.config.budgets.maxResults));
      const seen = new Set([id]);
      const edges: Array<{ source: string; type: string; target: string }> = [];
      let frontier = [id];
      for (let level = 0; level < maximumDepth && frontier.length && seen.size < maximumVisited; level += 1) {
        const next: string[] = [];
        for (const current of frontier) {
          const adjacent = database.prepare(`SELECT source_id, relation, target_id FROM edges
            WHERE source_id = ? OR target_id = ? ORDER BY source_id, relation, target_id`).all(current, current) as Array<Record<string, SQLOutputValue>>;
          for (const row of adjacent) {
            const relation = String(row.relation);
            if (relationTypes.length && !relationTypes.includes(relation)) continue;
            const source = String(row.source_id);
            const target = String(row.target_id);
            const neighbor = source === current ? target : source;
            if (!accessible.has(neighbor)) continue;
            if (!seen.has(neighbor) && seen.size < maximumVisited) { seen.add(neighbor); next.push(neighbor); }
            if (seen.has(source) && seen.has(target) && !edges.some((edge)=>edge.source===source && edge.target===target && edge.type===relation)) edges.push({source,type:relation,target});
          }
        }
        frontier = next;
      }
      const ids = [...seen].filter((node) => node !== id).sort();
      const key = this.#readKey(database,['related',id,access.target?.id,[...relationTypes].sort(),maximumDepth,maximumResults,ids,edges,conflicts,options.max_bytes,options.max_tokens]);
      // Independent edge events preserve links joining nodes on different pages.
      const events = [...ids.map((node)=>({kind:'node' as const,node})),...edges.map((edge)=>({kind:'edge' as const,edge}))];
      const start = offsetFor(options.cursor,key,events.length);
      const nodes: KnowledgeSummary[] = [];
      const pageEdges: typeof edges = [];
      let end = start;
      const make = () => {
        const pageIds = new Set([id,...nodes.map((node)=>node.id),...pageEdges.flatMap((edge)=>[edge.source,edge.target])]);
        const relevant=conflicts.filter((ref)=>ref.record_ids.some((recordId)=>pageIds.has(recordId))).slice(0,12);
        return measured({nodes,edges:pageEdges,visited_nodes:seen.size,conflicts:relevant,unresolved_conflicts:relevant.map((ref)=>ref.id),...this.#metadata(database),next_cursor:end<events.length?continuation(key,end):null,truncated:end<events.length || seen.size>=maximumVisited,omitted_result_count:events.slice(end).filter((event)=>event.kind==='node').length,omitted_edge_count:events.slice(end).filter((event)=>event.kind==='edge').length});
      };
      while (end<events.length) {
        const event=events[end]!;
        if (event.kind==='node') {
          if (nodes.length>=maximumResults) break;
          const item=accessible.get(event.node)!;
          nodes.push(summary(item.stored,item.record,'related-record',this.#freshness(item.record,access),this.paths.config,access.readableIds,conflicts.some((ref)=>ref.record_ids.includes(event.node))));
        } else {
          if (pageEdges.length>=maximumVisited) break;
          pageEdges.push(event.edge);
        }
        end++;
        if (!fits(make(),limits(this.paths.config,options))) {
          end--;
          if (event.kind==='node') nodes.pop(); else pageEdges.pop();
          break;
        }
      }
      if (!fits(make(),limits(this.paths.config,options)) || (end===start && events.length>start)) budgetError();
      return make();
    });
  }

  async taskContext(input: { repo_id: string; task: string; topics?: string[]; changed_paths?: string[]; source_revision?: string; max_tokens?: number; max_results?: number; depth?: number;expected_generation?:string;max_bytes?:number }): Promise<ContextBundle> {
    integer(input.max_results); integer(input.max_tokens); integer(input.max_bytes); integer(input.depth,0);
    controls({...(input.expected_generation===undefined?{}:{expected_generation:input.expected_generation}),...(input.max_bytes===undefined?{}:{max_bytes:input.max_bytes})});
    return this.#withIndex((database) => {
      const access = this.#accessibleSync(database, input.repo_id);
      checkGeneration(this.#metadata(database).index_generation,input.expected_generation);
      const { target, records } = access;
      const allConflicts = this.#conflicts(access);
      const policies = access.all.filter(({ record }) => record.type === 'approved-policy' && record.status !== 'superseded');
      const policy = policies.filter(({ record }) => record.status === 'verified').map((item) => ({ ...item, reason: 'applicable-mandatory-policy' }));
      const issues: PolicyIssue[] = [];
      for (const { record } of policies) {
        if (record.status === 'disputed') issues.push({ id: record.id, reason: 'disputed' });
        if (allConflicts.some((ref) => ref.record_ids.includes(record.id))) issues.push({ id: record.id, reason: 'conflict' });
        const projected = projectRecord(record, this.paths.config, access.readableIds);
        if (!hasApproval(projected)) issues.push({ id: record.id, reason: 'approval_evidence_unavailable' });
        const fresh = this.#freshness(record, access, input.source_revision);
        if (['needs_revalidation', 'dirty_worktree', 'unknown', 'revision_not_checked'].includes(fresh)) issues.push({ id: record.id, reason: fresh as PolicyIssue['reason'] });
        if (typeof record.review_after === 'string' && (!Number.isFinite(Date.parse(record.review_after)) || Date.parse(record.review_after) <= Date.now())) issues.push({ id: record.id, reason: 'review_due' });
      }
      const matches = this.#rank(database,access,input,input.source_revision);
      const mandatory = policy;
      const initial = [...mandatory, ...matches.filter((match) => !mandatory.some((item) => item.stored.id === match.stored.id))];
      const maxResults = Math.max(1, Math.min(input.max_results ?? this.paths.config.budgets.maxResults, this.paths.config.budgets.maxResults));
      const maxTokens = Math.max(1, Math.min(input.max_tokens ?? this.paths.config.budgets.maxTokens, this.paths.config.budgets.maxTokens));
      const maxDepth = Math.max(0, Math.min(input.depth ?? this.paths.config.budgets.maxDepth, this.paths.config.budgets.maxDepth));
      const maxVisited = this.paths.config.budgets.maxVisited;
      const relatedIds = this.#expand(database, initial.map(({ stored }) => stored.id), records, maxDepth);
      // Show accessible counterpart records when a matched record or applicable policy is conflicted.
      const seeds = new Set([...initial.map(({ record }) => record.id), ...policies.map(({ record }) => record.id), ...relatedIds]);
      let incomplete = seeds.size > maxVisited;
      let changed = true;
      while (changed) {
        changed = false;
        for (const ref of allConflicts) {
          if (!ref.record_ids.some((id) => seeds.has(id))) continue;
          for (const id of ref.record_ids) {
            if (seeds.has(id)) continue;
            if (seeds.size >= maxVisited) { incomplete = true; continue; }
            seeds.add(id); changed = true;
          }
        }
      }
      const conflicts = allConflicts.filter((ref) => ref.record_ids.some((id) => seeds.has(id)));
      for (const id of seeds) {
        const item = records.find(({ record }) => record.id === id);
        if (item && !initial.some(({ record }) => record.id === id)) initial.push({ ...item, reason: relatedIds.includes(id) ? 'curated-graph-neighbor' : 'conflicting-record' });
      }
      const expanded = [...initial];
      const mandatoryIds = new Set(mandatory.map(({ stored }) => stored.id));
      const source = { repo_id: target!.id, requested_revision: input.source_revision ?? null };
      const total = new Set([...initial.map(({ record }) => record.id), ...relatedIds]).size;
      const makeBundle = (selected: KnowledgeSummary[], exceeded = false) => this.#bundle(database, selected, total, exceeded, exceeded ? [...mandatoryIds] : [], source, conflicts, issues);
      const fits = (bundle: ContextBundle) => bundle.estimated_tokens <= maxTokens && Buffer.byteLength(JSON.stringify({ ok: true, data: bundle }), 'utf8') <= Math.min(input.max_bytes??this.paths.config.budgets.maxBytes,this.paths.config.budgets.maxBytes);
      const budgetFailure = () => {
        const failure = makeBundle([], true);
        if (!fits(failure)) throw new DomainError('CONTEXT_BUDGET_EXCEEDED', 'Required policy or conflict references cannot fit the requested context budget.');
        return failure;
      };
      if (incomplete || mandatoryIds.size > maxResults) return budgetFailure();
      const selected: KnowledgeSummary[] = [];
      for (const item of expanded) {
        if (selected.length >= maxResults && !mandatoryIds.has(item.stored.id)) continue;
        const next = summary(item.stored, item.record, item.reason, this.#freshness(item.record, access, input.source_revision), this.paths.config, access.readableIds, conflicts.some((ref) => ref.record_ids.includes(item.record.id)) || issues.some((issue) => issue.id === item.record.id));
        const tentative = makeBundle(selected.concat(next));
        if (!fits(tentative)) {
          if (mandatoryIds.has(item.stored.id)) {
            return budgetFailure();
          }
          continue;
        }
        selected.push(next);
      }
      const result = makeBundle(selected);
      if (!fits(result)) return budgetFailure();
      return result;
    });
  }

  #accessibleSync(database: DatabaseSync, repoId?: string): Access {
    const target = localRepo(this.paths.config, repoId);
    if (repoId && !target) throw new DomainError('NOT_FOUND', 'Repository is not registered.');
    const rows = database.prepare("SELECT * FROM records WHERE status IN ('verified', 'disputed', 'superseded') ORDER BY id").all() as Array<Record<string, SQLOutputValue>>;
    const all = rows.map(decodeRecord).filter((stored): stored is StoredRecord => Boolean(stored)).filter((stored) => scopeAllowed(JSON.parse(stored.scope_json) as KnowledgeRecord['scope'], this.paths.config, target)).map((stored) => ({ stored, record: parsedRecord(stored) })).filter(({ record }) => publishedVisible(record, this.paths.config, target, true));
    return { ...(target ? { target } : {}), all, readableIds: new Set(all.map(({ record }) => record.id)), records: all.filter(({ record }) => record.status === 'verified') };
  }

  #expand(database: DatabaseSync, roots: string[], records: Array<{ stored: StoredRecord; record: KnowledgeRecord }>, depth: number): string[] {
    if (depth < 1) return [];
    const allowed = new Set(records.map(({ stored }) => stored.id));
    const seen = new Set(roots);
    let frontier = roots;
    for (let level = 0; level < depth && frontier.length && seen.size < this.paths.config.budgets.maxVisited; level += 1) {
      const next: string[] = [];
      for (const current of frontier) {
        const rows = database.prepare('SELECT target_id FROM edges WHERE source_id = ?').all(current) as Array<Record<string, SQLOutputValue>>;
        for (const row of rows) {
          const neighbor = String(row.target_id);
          if (allowed.has(neighbor) && !seen.has(neighbor) && seen.size < this.paths.config.budgets.maxVisited) { seen.add(neighbor); next.push(neighbor); }
        }
      }
      frontier = next;
    }
    return [...seen].filter((id) => !roots.includes(id));
  }

  #bundle(database: DatabaseSync, results: KnowledgeSummary[], total: number, exceeded: boolean, omittedMandatory: string[] = [], application_source: ContextBundle['application_source'] = null, conflicts: ConflictReference[] = [], issues: PolicyIssue[] = []): ContextBundle {
    const bounded = conflicts.slice(0, 12);
    const bundle: ContextBundle = { status: exceeded ? 'CONTEXT_BUDGET_EXCEEDED' : issues.length ? 'POLICY_REVIEW_REQUIRED' : 'ok', ...this.#metadata(database), application_source, results, truncated: total > results.length || conflicts.length > bounded.length || issues.length > 12, estimated_tokens: 0, estimator_name: 'utf8-bytes-divided-by-3-conservative', unresolved_conflicts: bounded.map((ref) => ref.id), conflicts: bounded, policy_issues: issues.slice(0, 12), omitted_conflict_count: conflicts.length - bounded.length, omitted_result_count: Math.max(0, total - results.length) };
    if (omittedMandatory.length) bundle.omitted_mandatory_ids = omittedMandatory.slice(0, 12);
    for (let i = 0; i < 4; i += 1) {
      const estimate = tokenEstimate({ ok: true, data: bundle });
      if (bundle.estimated_tokens === estimate) break;
      bundle.estimated_tokens = estimate;
    }
    return bundle;
  }
}
