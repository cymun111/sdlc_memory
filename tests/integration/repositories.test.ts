import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { stringify } from 'yaml';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { resolvePaths, type ResolvedPaths } from '../../src/core/config.js';
import { buildActiveGeneration } from '../../src/indexing/build-index.js';
import { listRepositories } from '../../src/retrieval/repositories.js';

let root: string;
let paths: ResolvedPaths;
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'repository-discovery-'));
  await mkdir(path.join(root, 'schemas'));
  await copyFile('schemas/knowledge.schema.json', path.join(root, 'schemas/knowledge.schema.json'));
  await mkdir(path.join(root, 'knowledge'));
  paths = await resolvePaths({ root });
  paths.config.repositories = ['zebra', 'alpha', 'middle'].map((id) => ({ id, name: id, owner: 'local-owner', team: 'local', path: '/private/checkouts/' + id, aliases: id === 'alpha' ? ['old-name'] : [] }));
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
async function overview(id: string, repo: string, status = 'verified', sources: object[] = [{ kind: 'code', repo_id: repo, path: 'src/main.ts', commit: '1'.repeat(40) }]) {
  await writeFile(path.join(root, 'knowledge', id + '.md'), '---\n' + stringify({ schema_version: 1, id, title: 'Synthetic overview', summary: `Fictional ${repo} service responsibilities.`, type: 'overview', scope: { kind: 'repo', repo_id: repo }, status, owner: 'local-owner', sources, relationships: [], created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z' }) + '---\nSynthetic body.');
}

it('lists canonical identities without an index or local path disclosure and searches aliases', async () => {
  const result = await listRepositories(paths);
  expect(result.repositories.map((r) => r.id)).toEqual(['alpha', 'middle', 'zebra']);
  expect(result.index_status).toBe('unavailable');
  expect(result.repositories.every((r) => r.description === null)).toBe(true);
  expect(JSON.stringify(result)).not.toContain('/private');
  expect((await listRepositories(paths, { query: ' OLD-NAME ' })).repositories[0]?.id).toBe('alpha');
});

it('uses only evidenced published overviews in allowed repository scopes', async () => {
  await overview('alpha.overview', 'alpha');
  await overview('private.overview', 'secret-repo');
  await overview('middle.candidate', 'middle', 'candidate');
  await overview('fixture.zebra', 'zebra');
  await overview('zebra.no-evidence', 'zebra', 'verified', []);
  await buildActiveGeneration(root, paths.runtimeRoot);
  const result = await listRepositories(paths);
  expect(result.repositories[0]?.description).toContain('alpha service');
  expect(result.repositories[0]?.evidence?.record_id).toBe('alpha.overview');
  expect(result.repositories[0]?.freshness).toBe('revision_not_checked');
  expect(result.repositories.slice(1).every((r) => r.description_status === 'unavailable')).toBe(true);
  expect(JSON.stringify(result)).not.toMatch(/secret-repo|private.overview|src\/main/);
  expect((await listRepositories(paths, { query: 'secret-repo' })).repositories).toEqual([]);
  expect((await listRepositories(paths, { query: 'responsibilities' })).repositories).toHaveLength(1);
});

it('paginates deterministically and rejects invalid, changed-query and stale-index cursors', async () => {
  const first = await listRepositories(paths, { limit: 1 });
  const second = await listRepositories(paths, { limit: 1, cursor: first.next_cursor });
  const third = await listRepositories(paths, { limit: 1, cursor: second.next_cursor });
  expect([first, second, third].flatMap((p) => p.repositories.map((r) => r.id))).toEqual(['alpha', 'middle', 'zebra']);
  expect(third.next_cursor).toBeNull();
  await expect(listRepositories(paths, { limit: 1, cursor: 'invalid' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  await expect(listRepositories(paths, { limit: 1, cursor: first.next_cursor, query: 'alpha' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  await buildActiveGeneration(root, paths.runtimeRoot);
  await expect(listRepositories(paths, { limit: 1, cursor: first.next_cursor })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
});

it('invalidates cursors after access changes without returning removed metadata', async () => {
  const first = await listRepositories(paths, { limit: 1 });
  paths.config.repositories = paths.config.repositories.filter((r) => r.id !== 'zebra');
  await expect(listRepositories(paths, { limit: 1, cursor: first.next_cursor })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  expect(JSON.stringify(await listRepositories(paths))).not.toContain('zebra');
});

it('honors the serialized envelope byte budget and fails explicitly when one entry cannot fit', async () => {
  for (const repo of paths.config.repositories) repo.name = 'x'.repeat(300);
  paths.config.budgets.maxBytes = 800;
  const result = await listRepositories(paths);
  expect(Buffer.byteLength(JSON.stringify({ ok: true, data: result }))).toBeLessThanOrEqual(800);
  expect(result.next_cursor).not.toBeNull();
  paths.config.budgets.maxBytes = 100;
  await expect(listRepositories(paths)).rejects.toMatchObject({ code: 'CONTEXT_BUDGET_EXCEEDED' });
});

it('validates limits and returns a safe error for a broken active index', async () => {
  await expect(listRepositories(paths, { limit: 51 })).rejects.toThrow();
  await mkdir(paths.runtimeRoot);
  await writeFile(path.join(paths.runtimeRoot, 'index-active.json'), '{broken');
  await expect(listRepositories(paths)).rejects.toMatchObject({ code: 'INDEX_UNAVAILABLE' });
});
