import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import type { ResolvedPaths } from '../core/config.js';
import { DomainError } from '../capture/candidate-store.js';
import { parseKnowledgeMarkdown } from '../validation/record.js';

export const repositoryListInput = z.object({
  query: z.string().trim().max(200).optional(),
  limit: z.number().int().min(1).max(50).default(10),
  cursor: z.string().min(1).max(1024).optional()
}).strict();
const repositoryEntry = z.object({
  id: z.string(), name: z.string(),
  description: z.string().nullable(),
  description_status: z.enum(['available', 'unavailable']),
  evidence: z.object({ record_id: z.string(), content_hash: z.string() }).nullable(),
  freshness: z.enum(['revision_not_checked', 'unknown', 'unavailable'])
});
export const repositoryListOutput = z.object({
  repositories: z.array(repositoryEntry),
  next_cursor: z.string().nullable(),
  index_generation: z.string().nullable(),
  index_status: z.enum(['available', 'unavailable'])
});
type Entry = z.infer<typeof repositoryEntry>;
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Local configuration is the trusted repository allowlist, as in KnowledgeService.
 * Never discover repositories from knowledge records or expose checkout paths.
 */
export async function listRepositories(paths: ResolvedPaths, request: unknown = {}) {
  const input = repositoryListInput.parse(request);
  const query = (input.query ?? '').toLowerCase();
  const repos = [...paths.config.repositories].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const entries = new Map<string, Entry>(repos.map((repo) => [repo.id, {
    id: repo.id, name: repo.name, description: null, description_status: 'unavailable', evidence: null, freshness: 'unavailable'
  }]));
  let generation: string | null = null;
  let status: 'available' | 'unavailable' = 'unavailable';
  let indexFile: string | undefined;
  try {
    const active = JSON.parse(await readFile(path.join(paths.runtimeRoot, 'index-active.json'), 'utf8')) as { database?: unknown };
    if (typeof active.database !== 'string') throw new Error('Invalid manifest');
    indexFile = path.resolve(paths.runtimeRoot, active.database);
    if (!indexFile.startsWith(path.resolve(paths.runtimeRoot) + path.sep)) throw new Error('Invalid index path');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new DomainError('INDEX_UNAVAILABLE', 'Cannot read the active index; rebuild with knowledge index --full');
  }
  if (indexFile) {
    let database: DatabaseSync | undefined;
    try {
      database = new DatabaseSync(indexFile, { readOnly: true });
      const manifest = database.prepare('SELECT generation FROM index_manifest WHERE singleton = 1').get();
      if (!manifest) throw new Error('Missing index manifest');
      generation = String(manifest.generation);
      // Query each allowed scope before parsing metadata. Other scopes never enter the response.
      for (const repo of repos) {
        const rows = database.prepare("SELECT body, content_hash FROM records WHERE status = 'verified' AND type = 'overview' AND scope_kind = 'repo' AND json_extract(scope_json, '$.repo_id') = ? ORDER BY id").all(repo.id);
        for (const row of rows) {
          const record = await parseKnowledgeMarkdown(String(row.body), paths.knowledgeRoot);
          if (record.scope.kind !== 'repo' || record.scope.repo_id !== repo.id || record.id.startsWith('fixture.') || record.owner === 'fixture-owner' || record.tags?.includes('fixture') || !record.sources.length) continue;
          entries.set(repo.id, { id: repo.id, name: repo.name, description: record.summary, description_status: 'available', evidence: { record_id: record.id, content_hash: String(row.content_hash) }, freshness: record.sources.some((source) => source.kind === 'code') ? 'revision_not_checked' : 'unknown' });
          break;
        }
      }
      status = 'available';
    } catch {
      throw new DomainError('INDEX_UNAVAILABLE', 'Cannot read repository overviews; rebuild with knowledge index --full');
    } finally { database?.close(); }
  }
  const filtered = repos.filter((repo) => [repo.id, repo.name, ...repo.aliases, entries.get(repo.id)!.description ?? ''].some((value) => value.toLowerCase().includes(query))).map((repo) => entries.get(repo.id)!);
  const snapshot = digest({ principal: paths.config.principal, repos: repos.map(({ id, name, aliases }) => ({ id, name, aliases })), generation, query, limit: input.limit, entries: filtered });
  let offset = 0;
  if (input.cursor) {
    try {
      if (!/^[A-Za-z0-9_-]+$/.test(input.cursor)) throw new Error();
      const cursor = z.object({ snapshot: z.string(), offset: z.number().int().positive() }).strict().parse(JSON.parse(Buffer.from(input.cursor, 'base64url').toString('utf8')));
      if (cursor.snapshot !== snapshot || cursor.offset >= filtered.length) throw new Error();
      offset = cursor.offset;
    } catch { throw new DomainError('VALIDATION_ERROR', 'Invalid or stale cursor; restart repository discovery without a cursor'); }
  }
  const result = (selected: Entry[]) => {
    const next = offset + selected.length;
    return { repositories: selected, next_cursor: next < filtered.length ? Buffer.from(JSON.stringify({ snapshot, offset: next })).toString('base64url') : null, index_generation: generation, index_status: status };
  };
  const selected = filtered.slice(offset, offset + input.limit);
  while (Buffer.byteLength(JSON.stringify({ ok: true, data: result(selected) }), 'utf8') > paths.config.budgets.maxBytes) {
    if (selected.length <= 1) throw new DomainError('CONTEXT_BUDGET_EXCEEDED', 'Repository metadata cannot fit the configured response byte budget');
    selected.pop();
  }
  return repositoryListOutput.parse(result(selected));
}
