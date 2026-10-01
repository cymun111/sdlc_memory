import { execFileSync } from 'node:child_process';
import path from 'node:path';
import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';
import type { LocalConfig, RegisteredRepo, ResolvedPaths } from '../core/config.js';
import type { KnowledgeRecord } from '../core/types.js';
import { openIndex } from '../indexing/database.js';
import { parse } from 'yaml';

interface StoredRecord { id: string; title: string; summary: string; type: string; scope_kind: string; scope_json: string; status: string; body: string; content_hash: string }
export interface KnowledgeSummary { id: string; title: string; summary: string; type: string; scope: unknown; matched_reasons: string[]; evidence: unknown[]; freshness: string; relationships: Array<{ type: string; target: string }> }
export interface ContextBundle { status: 'ok' | 'CONTEXT_BUDGET_EXCEEDED'; knowledge_revision: string; index_generation: string; results: KnowledgeSummary[]; truncated: boolean; estimated_tokens: number; estimator_name: string; unresolved_conflicts: string[]; omitted_result_count: number; omitted_mandatory_ids?: string[] }

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

function scopeAllowed(record: KnowledgeRecord, config: LocalConfig, target?: RegisteredRepo): boolean {
  switch (record.scope.kind) {
    case 'shared': return true;
    case 'team': return target ? target.team === record.scope.team_id : config.teams.includes(record.scope.team_id);
    case 'repo': {
      const repoId = record.scope.repo_id;
      return target ? target.id === repoId : config.repositories.some((repo) => repo.id === repoId);
    }
    case 'cross-repo': return target ? record.scope.repo_ids.includes(target.id) : record.scope.repo_ids.some((id) => config.repositories.some((repo) => repo.id === id));
  }
}

function isFixture(record: KnowledgeRecord): boolean {
  return (record.tags ?? []).includes('fixture') || record.owner === 'fixture-owner' || record.id.startsWith('fixture.');
}

function canRead(record: KnowledgeRecord, config: LocalConfig, target?: RegisteredRepo): boolean {
  if (!scopeAllowed(record, config, target)) return false;
  if (target && isFixture(record)) return false;
  return record.status === 'verified';
}

function git(repo: RegisteredRepo, args: string[]): string {
  return execFileSync('git', ['-C', repo.path, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

function sourceFreshness(record: KnowledgeRecord, config: LocalConfig, sourceRevision?: string): string {
  let sawCode = false;
  for (const raw of record.sources) {
    if (raw.kind !== 'code') continue;
    sawCode = true;
    const repo = config.repositories.find((candidate) => candidate.id === raw.repo_id);
    if (!repo || typeof raw.commit !== 'string' || !/^[0-9a-f]{40}$/i.test(raw.commit) || typeof raw.path !== 'string') return 'unknown';
    const relative = raw.path.replaceAll('\\', '/');
    if (relative.startsWith('/') || relative.split('/').includes('..')) return 'unknown';
    try {
      const citedBlob = git(repo, ['rev-parse', `${raw.commit}:${relative}`]);
      if (sourceRevision) {
        const requestedBlob = git(repo, ['rev-parse', `${sourceRevision}:${relative}`]);
        if (citedBlob !== requestedBlob) return 'needs_revalidation';
        if (git(repo, ['status', '--porcelain', '--', relative])) return 'dirty_worktree';
        const currentBlob = git(repo, ['hash-object', '--', relative]);
        if (currentBlob !== requestedBlob) return 'dirty_worktree';
      }
    } catch { return 'unknown'; }
  }
  return sawCode ? (sourceRevision ? 'verified_at_revision' : 'revision_not_checked') : 'not_applicable';
}

function manifest(database: DatabaseSync, paths: ResolvedPaths): { knowledgeRevision: string; indexGeneration: string } {
  const row = database.prepare('SELECT generation FROM index_manifest WHERE singleton = 1').get() as { generation?: string } | undefined;
  let knowledgeRevision = 'unknown';
  try { knowledgeRevision = execFileSync('git', ['-C', paths.knowledgeRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* Unversioned local fixture checkout. */ }
  return { knowledgeRevision, indexGeneration: row?.generation ?? 'unavailable' };
}

function tokenEstimate(value: unknown): number {
  return Math.ceil(Buffer.byteLength(JSON.stringify(value), 'utf8') / 3);
}

function summary(stored: StoredRecord, record: KnowledgeRecord, reason: string, freshness: string): KnowledgeSummary {
  return { id: stored.id, title: stored.title, summary: stored.summary, type: stored.type, scope: record.scope, matched_reasons: [reason], evidence: record.sources, freshness, relationships: record.relationships };
}

export class KnowledgeService {
  constructor(readonly paths: ResolvedPaths) {}

  async #withIndex<T>(callback: (database: DatabaseSync) => T): Promise<T> {
    const database = await openIndex(this.paths.runtimeRoot);
    try { return callback(database); } finally { database.close(); }
  }

  async #accessible(database: DatabaseSync, repoId?: string): Promise<{ target?: RegisteredRepo; records: Array<{ stored: StoredRecord; record: KnowledgeRecord }> }> {
    const target = localRepo(this.paths.config, repoId);
    if (repoId && !target) throw new Error(`Repository is not registered: ${repoId}`);
    const rows = database.prepare("SELECT * FROM records WHERE status = 'verified'").all() as Array<Record<string, SQLOutputValue>>;
    const records = rows.map(decodeRecord).filter((stored): stored is StoredRecord => Boolean(stored)).map((stored) => ({ stored, record: parsedRecord(stored) }));
    return { ...(target ? { target } : {}), records: records.filter(({ record }) => canRead(record, this.paths.config, target)) };
  }

  async search(query: string, repoId?: string, limit = 10): Promise<{ results: KnowledgeSummary[]; knowledge_revision: string; index_generation: string }> {
    return this.#withIndex((database) => {
      const accessible = this.#accessibleSync(database, repoId);
      const allowed = accessible.records.map(({ stored }) => stored.id);
      if (!allowed.length || !query.trim()) {
        const meta = manifest(database, this.paths);
        return { results: [], knowledge_revision: meta.knowledgeRevision, index_generation: meta.indexGeneration };
      }
      const rows = database.prepare(`SELECT r.* FROM record_search s JOIN records r ON r.id = s.id
        WHERE record_search MATCH ? AND r.id IN (${allowed.map(() => '?').join(',')})
        ORDER BY bm25(record_search) LIMIT ?`).all(tokenize(query), ...allowed, Math.max(1, Math.min(limit, 50))) as Array<Record<string, SQLOutputValue>>;
      const results = rows.map(decodeRecord).filter((stored): stored is StoredRecord => Boolean(stored)).map((stored) => {
        const record = parsedRecord(stored);
        return summary(stored, record, 'full-text-match', sourceFreshness(record, this.paths.config));
      });
      const meta = manifest(database, this.paths);
      return { results, knowledge_revision: meta.knowledgeRevision, index_generation: meta.indexGeneration };
    });
  }

  async get(id: string, repoId?: string, byteLimit = 8192): Promise<{ record: KnowledgeSummary; body: string; truncated: boolean; knowledge_revision: string; index_generation: string }> {
    return this.#withIndex((database) => {
      if (repoId && !localRepo(this.paths.config, repoId)) throw new Error(`Repository is not registered: ${repoId}`);
      const stored = readRecord(database, id);
      if (!stored) throw new Error(`Knowledge record not found: ${id}`);
      const record = parsedRecord(stored);
      if (!canRead(record, this.paths.config, localRepo(this.paths.config, repoId))) throw new Error(`Knowledge record not found: ${id}`);
      const limit = Math.max(1, Math.min(byteLimit, this.paths.config.budgets.maxBytes));
      const bytes = Buffer.from(stored.body, 'utf8');
      const body = bytes.length > limit ? bytes.subarray(0, limit).toString('utf8') : stored.body;
      const meta = manifest(database, this.paths);
      return { record: summary(stored, record, 'direct-lookup', sourceFreshness(record, this.paths.config)), body, truncated: bytes.length > limit, knowledge_revision: meta.knowledgeRevision, index_generation: meta.indexGeneration };
    });
  }

  async related(id: string, repoId?: string, relationTypes: string[] = [], depth = 1, limit = 12): Promise<{ nodes: KnowledgeSummary[]; edges: Array<{ source: string; type: string; target: string }>; visited_nodes: number; knowledge_revision: string; index_generation: string }> {
    return this.#withIndex((database) => {
      const access = this.#accessibleSync(database, repoId);
      const accessible = new Map(access.records.map(({ stored, record }) => [stored.id, { stored, record }]));
      if (!accessible.has(id)) throw new Error(`Knowledge record not found: ${id}`);
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
        return summary(item.stored, item.record, 'related-record', sourceFreshness(item.record, this.paths.config));
      });
      const meta = manifest(database, this.paths);
      return { nodes, edges: edges.slice(0, maximumVisited), visited_nodes: seen.size, knowledge_revision: meta.knowledgeRevision, index_generation: meta.indexGeneration };
    });
  }

  async taskContext(input: { repo_id: string; task: string; topics?: string[]; changed_paths?: string[]; source_revision?: string; max_tokens?: number; max_results?: number; depth?: number }): Promise<ContextBundle> {
    return this.#withIndex((database) => {
      const { target, records } = this.#accessibleSync(database, input.repo_id);
      const policy = records.filter(({ record }) => record.type === 'approved-policy').map((item) => ({ ...item, reason: 'applicable-mandatory-policy' }));
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
          } catch { matches = []; }
        }
      }
      const mandatory = policy.filter(({ record }) => sourceFreshness(record, this.paths.config, input.source_revision) !== 'needs_revalidation');
      const initial = [...mandatory, ...matches.filter((match) => !mandatory.some((item) => item.stored.id === match.stored.id))];
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
      const selected: KnowledgeSummary[] = [];
      for (const item of expanded) {
        if (selected.length >= maxResults && !mandatoryIds.has(item.stored.id)) continue;
        const next = summary(item.stored, item.record, item.reason, sourceFreshness(item.record, this.paths.config, input.source_revision));
        const tentative = this.#bundle(database, selected.concat(next), initial.length + relatedIds.length, false);
        const estimatedTokens = tokenEstimate(tentative);
        const byteCount = Buffer.byteLength(JSON.stringify(tentative), 'utf8');
        if (estimatedTokens > maxTokens || byteCount > this.paths.config.budgets.maxBytes) {
          if (mandatoryIds.has(item.stored.id)) {
            return this.#bundle(database, [], initial.length + relatedIds.length, true, [...mandatoryIds]);
          }
          continue;
        }
        selected.push(next);
      }
      return this.#bundle(database, selected, initial.length + relatedIds.length, false);
    });
  }

  #accessibleSync(database: DatabaseSync, repoId?: string): { target?: RegisteredRepo; records: Array<{ stored: StoredRecord; record: KnowledgeRecord }> } {
    const target = localRepo(this.paths.config, repoId);
    if (repoId && !target) throw new Error(`Repository is not registered: ${repoId}`);
    const rows = database.prepare("SELECT * FROM records WHERE status = 'verified'").all() as Array<Record<string, SQLOutputValue>>;
    const records = rows.map(decodeRecord).filter((stored): stored is StoredRecord => Boolean(stored)).map((stored) => ({ stored, record: parsedRecord(stored) }));
    return { ...(target ? { target } : {}), records: records.filter(({ record }) => canRead(record, this.paths.config, target)) };
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

  #bundle(database: DatabaseSync, results: KnowledgeSummary[], total: number, exceeded: boolean, omittedMandatory: string[] = []): ContextBundle {
    const meta = manifest(database, this.paths);
    const bundle: ContextBundle = { status: exceeded ? 'CONTEXT_BUDGET_EXCEEDED' : 'ok', knowledge_revision: meta.knowledgeRevision, index_generation: meta.indexGeneration, results, truncated: total > results.length, estimated_tokens: 0, estimator_name: 'utf8-bytes-divided-by-3-conservative', unresolved_conflicts: [], omitted_result_count: Math.max(0, total - results.length) };
    if (omittedMandatory.length) bundle.omitted_mandatory_ids = omittedMandatory.slice(0, 12);
    bundle.estimated_tokens = tokenEstimate(bundle);
    return bundle;
  }
}
