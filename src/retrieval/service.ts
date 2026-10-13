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

interface StoredRecord { id: string; title: string; summary: string; type: string; scope_kind: string; scope_json: string; status: string; body: string; content_hash: string }
export interface KnowledgeSummary { id: string; title: string; summary: string; type: string; scope: unknown; matched_reasons: string[]; evidence: unknown[]; freshness: string; relationships: Array<{ type: string; target: string }>; editorial_status: string; normative: boolean; requires_review: boolean }
export interface ContextBundle { status: 'ok' | 'CONTEXT_BUDGET_EXCEEDED' | 'POLICY_REVIEW_REQUIRED'; knowledge_revision: string; index_generation: string; knowledge_snapshot: KnowledgeSnapshotMetadata; checkout_drift: CheckoutDrift; application_source: { repo_id: string; requested_revision: string | null } | null; results: KnowledgeSummary[]; truncated: boolean; estimated_tokens: number; estimator_name: string; unresolved_conflicts: string[]; conflicts: ConflictReference[]; policy_issues: PolicyIssue[]; omitted_conflict_count: number; omitted_result_count: number; omitted_mandatory_ids?: string[] }
type Item = { stored: StoredRecord; record: KnowledgeRecord };
type Access = { target?: RegisteredRepo; records: Item[]; all: Item[]; readableIds: Set<string> };

function tokenize(query: string): string {
  const terms = query.toLowerCase().match(/[\p{L}\p{N}_.-]+/gu) ?? [];
  if (!terms.length) return '""';
  return terms.slice(0, 32).map((term) => `"${term.replaceAll('"', '""')}"`).join(' AND ');
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

function summary(stored: StoredRecord, record: KnowledgeRecord, reason: string, freshness: string, config: LocalConfig, readableIds: Set<string>, review = false): KnowledgeSummary {
  const projected = projectRecord(record, config, readableIds);
  const due = typeof record.review_after === 'string' && (!Number.isFinite(Date.parse(record.review_after)) || Date.parse(record.review_after) <= Date.now());
  const requires_review = review || record.status === 'disputed' || (record.type === 'approved-policy' && (due || !hasApproval(projected) || !['not_applicable', 'verified_at_revision'].includes(freshness)));
  return { id: stored.id, title: stored.title, summary: stored.summary, type: stored.type, scope: projected.scope, matched_reasons: [reason], evidence: projected.sources, freshness, relationships: projected.relationships, editorial_status: record.status, normative: record.type === 'approved-policy' && record.status === 'verified' && !requires_review, requires_review };
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

  async search(query: string, repoId?: string, limit = 10) {
    return this.#withIndex((database) => {
      const accessible = this.#accessibleSync(database, repoId);
      const conflicts = this.#conflicts(accessible);
      const allowed = accessible.records.map(({ stored }) => stored.id);
      if (!allowed.length || !query.trim()) {
        return { results: [], unresolved_conflicts: [], conflicts: [], ...this.#metadata(database) };
      }
      const rows = database.prepare(`SELECT r.* FROM record_search s JOIN records r ON r.id = s.id
        WHERE record_search MATCH ? AND r.id IN (${allowed.map(() => '?').join(',')})
        ORDER BY bm25(record_search) LIMIT ?`).all(tokenize(query), ...allowed, Math.max(1, Math.min(limit, 50))) as Array<Record<string, SQLOutputValue>>;
      const results = rows.map(decodeRecord).filter((stored): stored is StoredRecord => Boolean(stored)).map((stored) => {
        const record = parsedRecord(stored);
        return summary(stored, record, 'full-text-match', this.#freshness(record, accessible), this.paths.config, accessible.readableIds, conflicts.some((ref) => ref.record_ids.includes(record.id)));
      });
      const relevant = conflicts.filter((ref) => ref.record_ids.some((id) => results.some((result) => result.id === id))).slice(0, 12);
      return { results, unresolved_conflicts: relevant.map((ref) => ref.id), conflicts: relevant, ...this.#metadata(database) };
    });
  }

  async get(id: string, repoId?: string, byteLimit = 8192, includeHistory = false) {
    if (!Number.isInteger(byteLimit) || byteLimit < 1 || byteLimit > 32768 || typeof includeHistory !== 'boolean') throw new DomainError('VALIDATION_ERROR', 'Invalid direct-read options.');
    return this.#withIndex((database) => {
      if (repoId && !localRepo(this.paths.config, repoId)) throw new DomainError('NOT_FOUND', 'Repository is not registered.');
      const stored = readRecord(database, id);
      if (!stored) throw new DomainError('NOT_FOUND', 'Knowledge record not found.');
      if (!scopeAllowed(JSON.parse(stored.scope_json) as KnowledgeRecord['scope'], this.paths.config, localRepo(this.paths.config, repoId)) || !(stored.status === 'verified' || (includeHistory && ['disputed', 'superseded'].includes(stored.status)))) throw new DomainError('NOT_FOUND', 'Knowledge record not found.');
      const record = parsedRecord(stored);
      if (!publishedVisible(record, this.paths.config, localRepo(this.paths.config, repoId), includeHistory)) throw new DomainError('NOT_FOUND', 'Knowledge record not found.');
      const access = this.#accessibleSync(database, repoId);
      const conflicts = this.#conflicts(access).filter((ref) => ref.record_ids.includes(id)).slice(0, 12);
      const projection = projectRecord(record, this.paths.config, access.readableIds);
      const projectedBody = projectBody(stored.body, record, projection);
      const limit = Math.max(1, Math.min(byteLimit, this.paths.config.budgets.maxBytes));
      const bytes = Buffer.from(projectedBody.body, 'utf8');
      let end = Math.min(bytes.length, limit);
      while (end < bytes.length && end > 0 && (bytes[end]! & 0xc0) === 0x80) end -= 1;
      const body = bytes.subarray(0, end).toString('utf8');
      return { record: summary(stored, record, 'direct-lookup', this.#freshness(record, access), this.paths.config, access.readableIds, conflicts.length > 0), body, redacted: projectedBody.redacted, historical: record.status !== 'verified', truncated: bytes.length > end, unresolved_conflicts: conflicts.map((ref) => ref.id), conflicts, ...this.#metadata(database) };
    });
  }

  async related(id: string, repoId?: string, relationTypes: string[] = [], depth = 1, limit = 12) {
    return this.#withIndex((database) => {
      const access = this.#accessibleSync(database, repoId);
      const conflicts = this.#conflicts(access);
      const accessible = new Map(access.records.map(({ stored, record }) => [stored.id, { stored, record }]));
      if (!accessible.has(id)) throw new DomainError('NOT_FOUND', 'Knowledge record not found.');
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
            WHERE source_id = ? OR target_id = ?`).all(current, current) as Array<Record<string, SQLOutputValue>>;
          for (const row of adjacent) {
            const relation = String(row.relation);
            if (relationTypes.length && !relationTypes.includes(relation)) continue;
            const source = String(row.source_id);
            const target = String(row.target_id);
            const neighbor = source === current ? target : source;
            if (!accessible.has(neighbor)) continue;
            edges.push({ source, type: relation, target });
            if (!seen.has(neighbor) && seen.size < maximumVisited) { seen.add(neighbor); next.push(neighbor); }
          }
        }
        frontier = next;
      }
      const nodes = [...seen].filter((node) => node !== id).slice(0, maximumResults).map((node) => {
        const item = accessible.get(node)!;
        return summary(item.stored, item.record, 'related-record', this.#freshness(item.record, access), this.paths.config, access.readableIds, conflicts.some((ref) => ref.record_ids.includes(node)));
      });
      return { nodes, edges: edges.slice(0, maximumVisited), visited_nodes: seen.size, ...this.#metadata(database) };
    });
  }

  async taskContext(input: { repo_id: string; task: string; topics?: string[]; changed_paths?: string[]; source_revision?: string; max_tokens?: number; max_results?: number; depth?: number }): Promise<ContextBundle> {
    return this.#withIndex((database) => {
      const access = this.#accessibleSync(database, input.repo_id);
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
      const allowedIds = records.map(({ stored }) => stored.id);
      let matches: Array<{ stored: StoredRecord; record: KnowledgeRecord; reason: string }> = [];
      if (allowedIds.length) {
        const query = [input.task, ...(input.topics ?? []), ...(input.changed_paths ?? [])].join(' ').trim();
        if (query) {
          try {
            const rows = database.prepare(`SELECT r.* FROM record_search s JOIN records r ON r.id = s.id
              WHERE record_search MATCH ? AND r.id IN (${allowedIds.map(() => '?').join(',')})
              ORDER BY bm25(record_search) LIMIT ?`).all(tokenize(query), ...allowedIds, this.paths.config.budgets.maxResults * 3) as Array<Record<string, SQLOutputValue>>;
            matches = rows.map(decodeRecord).filter((stored): stored is StoredRecord => Boolean(stored)).map((stored) => ({ stored, record: parsedRecord(stored), reason: 'task-text-match' }));
          } catch { throw new DomainError('INDEX_QUERY_FAILED', 'The knowledge query failed; check or rebuild the active index.'); }
        }
      }
      const mandatory = policy;
      const initial = [...mandatory, ...matches.filter((match) => !mandatory.some((item) => item.stored.id === match.stored.id))];
      // Show accessible counterpart records when a matched record or applicable policy is conflicted.
      const seeds = new Set([...initial.map(({ record }) => record.id), ...policies.map(({ record }) => record.id)]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const ref of allConflicts) if (ref.record_ids.some((id) => seeds.has(id))) for (const id of ref.record_ids) if (!seeds.has(id)) { seeds.add(id); changed = true; }
      }
      const conflicts = allConflicts.filter((ref) => ref.record_ids.some((id) => seeds.has(id)));
      for (const id of seeds) {
        const item = records.find(({ record }) => record.id === id);
        if (item && !initial.some(({ record }) => record.id === id)) initial.push({ ...item, reason: 'conflicting-record' });
      }
      const maxResults = Math.max(1, Math.min(input.max_results ?? this.paths.config.budgets.maxResults, this.paths.config.budgets.maxResults));
      const maxTokens = Math.max(1, Math.min(input.max_tokens ?? this.paths.config.budgets.maxTokens, this.paths.config.budgets.maxTokens));
      const maxDepth = Math.max(0, Math.min(input.depth ?? this.paths.config.budgets.maxDepth, this.paths.config.budgets.maxDepth));
      const relatedIds = this.#expand(database, initial.map(({ stored }) => stored.id), records, maxDepth);
      const expanded = [...initial];
      for (const id of relatedIds) {
        if (expanded.length >= maxResults) break;
        const item = records.find(({ stored }) => stored.id === id);
        if (item && !expanded.some(({ stored }) => stored.id === id)) expanded.push({ ...item, reason: 'curated-graph-neighbor' });
      }
      const mandatoryIds = new Set(mandatory.map(({ stored }) => stored.id));
      const source = { repo_id: target!.id, requested_revision: input.source_revision ?? null };
      const total = new Set([...initial.map(({ record }) => record.id), ...relatedIds]).size;
      const makeBundle = (selected: KnowledgeSummary[], exceeded = false) => this.#bundle(database, selected, total, exceeded, exceeded ? [...mandatoryIds] : [], source, conflicts, issues);
      const fits = (bundle: ContextBundle) => bundle.estimated_tokens <= maxTokens && Buffer.byteLength(JSON.stringify({ ok: true, data: bundle }), 'utf8') <= this.paths.config.budgets.maxBytes;
      const budgetFailure = () => {
        const failure = makeBundle([], true);
        if (!fits(failure)) throw new DomainError('CONTEXT_BUDGET_EXCEEDED', 'Required policy or conflict references cannot fit the requested context budget.');
        return failure;
      };
      if (mandatoryIds.size > maxResults) return budgetFailure();
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
