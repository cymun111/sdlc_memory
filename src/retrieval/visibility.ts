import { stringify } from 'yaml';
import type { KnowledgeRecord, Scope } from '../core/types.js';
import type { LocalConfig, RegisteredRepo } from '../core/config.js';

export function scopeAllowed(scope: Scope, config: LocalConfig, target?: RegisteredRepo): boolean {
  switch (scope.kind) {
    case 'shared': return true;
    case 'team': return target ? target.team === scope.team_id : config.teams.includes(scope.team_id);
    case 'repo': return target ? target.id === scope.repo_id : config.repositories.some((repo) => repo.id === scope.repo_id);
    case 'cross-repo': return target ? scope.repo_ids.includes(target.id) : scope.repo_ids.some((id) => config.repositories.some((repo) => repo.id === id));
  }
}
export function publishedVisible(record: KnowledgeRecord, config: LocalConfig, target?: RegisteredRepo, history = false): boolean {
  if (!scopeAllowed(record.scope, config, target)) return false;
  if (target && ((record.tags ?? []).includes('fixture') || record.owner === 'fixture-owner' || record.id.startsWith('fixture.'))) return false;
  return record.status === 'verified' || (history && ['disputed', 'superseded'].includes(record.status));
}
const safeText = (value: unknown, max = 2000): value is string => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f]/u.test(value);
const safePath = (value: unknown): value is string => safeText(value) && !value.startsWith('/') && !value.includes('\\') && !value.includes(':') && !value.split('/').includes('..');
function url(value: unknown): value is string {
  if (!safeText(value)) return false;
  try { const parsed = new URL(value); return ['https:', 'http:'].includes(parsed.protocol) && !parsed.username && !parsed.password; } catch { return false; }
}
export function projectEvidence(sources: KnowledgeRecord['sources'], config: LocalConfig, readableIds: Set<string>): KnowledgeRecord['sources'] {
  const allowedRepos = new Set(config.repositories.map((repo) => repo.id));
  const output: KnowledgeRecord['sources'] = [];
  for (const source of sources) {
    if (source.repo_id !== undefined && !allowedRepos.has(String(source.repo_id))) continue;
    if (['code', 'test'].includes(String(source.kind))) {
      if (!allowedRepos.has(String(source.repo_id)) || !safePath(source.path) || typeof source.commit !== 'string' || !/^[a-f0-9]{40,64}$/i.test(source.commit)) continue;
      const projected: Record<string, unknown> = { kind: source.kind, repo_id: source.repo_id, commit: source.commit, path: source.path };
      if (safeText(source.symbol, 300)) projected.symbol = source.symbol;
      if (typeof source.content_hash === 'string' && /^[a-f0-9]{64}$/i.test(source.content_hash)) projected.content_hash = source.content_hash;
      if (source.kind === 'test' && safeText(source.test_id, 300)) projected.test_id = source.test_id;
      output.push(projected);
    } else if (source.kind === 'decision') {
      const link = source.url ?? source.reference;
      if (!url(link) || !safeText(source.approver, 200) || typeof source.approved_at !== 'string' || !/^\d{4}-\d\d-\d\dT/.test(source.approved_at) || !Number.isFinite(Date.parse(source.approved_at))) continue;
      output.push({ kind: 'decision', url: link, approver: source.approver, approved_at: source.approved_at });
    } else if (source.kind === 'documentation') {
      const reference = source.reference ?? source.url;
      if (typeof reference === 'string' && reference.startsWith('knowledge:') && readableIds.has(reference.slice(10))) output.push({ kind: 'documentation', reference });
      else if (url(reference)) output.push({ kind: 'documentation', reference });
    }
  }
  return output;
}
export function projectRecord(record: KnowledgeRecord, config: LocalConfig, readableIds: Set<string>): KnowledgeRecord {
  const scope = record.scope.kind === 'cross-repo' ? { kind: 'cross-repo' as const, repo_ids: record.scope.repo_ids.filter((id) => config.repositories.some((repo) => repo.id === id)) } : record.scope;
  const projected: KnowledgeRecord = { ...record, scope, sources: projectEvidence(record.sources, config, readableIds), relationships: record.relationships.filter((edge) => readableIds.has(edge.target)) };
  if (Array.isArray(record.supersedes)) projected.supersedes = record.supersedes.filter((id) => typeof id === 'string' && readableIds.has(id));
  return projected;
}
export function projectBody(body: string, record: KnowledgeRecord, projected: KnowledgeRecord): { body: string; redacted: boolean } {
  if (JSON.stringify(record) === JSON.stringify(projected)) return { body, redacted: false };
  const normalized = body.replace(/\r\n/g, '\n');
  const end = normalized.indexOf('\n---', 4);
  return { body: '---\n' + stringify(projected).trimEnd() + '\n---' + normalized.slice(end + 4), redacted: true };
}
export function hasApproval(record: KnowledgeRecord): boolean { return record.sources.some((source) => source.kind === 'decision'); }
