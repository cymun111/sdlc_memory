import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { beforeEach, afterEach, expect, it } from 'vitest';
import { resolvePaths, registerRepository, type ResolvedPaths } from '../../src/core/config.js';
import { buildRepositoryMap, getRepositoryMap, repositoryMapSchema } from '../../src/retrieval/repository-map.js';
let root: string, source: string, paths: ResolvedPaths;
function git(...args: string[]) { return execFileSync('git', ['-C', source, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
async function file(name: string, content: string | Buffer) { const target = path.join(source, name); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, content); }
function commit() { git('add', '.'); git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'Synthetic fixture'); return git('rev-parse', 'HEAD'); }
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'knowledge-map-')); source = path.join(root, 'source'); await mkdir(source); git('init');
  paths = await resolvePaths({ root }); await registerRepository(paths, { id: 'sample-app', repoPath: source, owner: 'local-owner', team: 'local' });
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
it('extracts single-package commands, entry points, evidence, and extension-based languages', async () => {
  await file('package.json', JSON.stringify({ main: 'src/main.ts', scripts: { test: 'do-not-copy-secret-value', dev: 'node src/main.ts' } }));
  await file('src/main.ts', 'export const value = 1;'); await file('tests/main.test.ts', 'test fixture'); const revision = commit();
  const built = await buildRepositoryMap(paths, 'sample-app'); expect(built.source_revision).toBe(revision);
  const entries = await getRepositoryMap(paths, { repo_id: 'sample-app', section: 'entry_points' }); expect(entries.items[0]?.path).toBe('src/main.ts');
  expect(entries.items[0]?.evidence.blob_hash).toBe(git('rev-parse', 'HEAD:package.json'));
  const commands = await getRepositoryMap(paths, { repo_id: 'sample-app', section: 'commands' }); expect(commands.items.map((i) => i.label)).toEqual(['npm run dev', 'npm run test']); expect(JSON.stringify(commands)).not.toContain('do-not-copy');
  const summary = await getRepositoryMap(paths, { repo_id: 'sample-app' }); expect(summary.counts.tests).toBe(1); expect(summary.freshness.dirty_worktree).toBe(false);
  const mapFiles = await readdir(path.join(paths.runtimeRoot, 'repository-maps')); repositoryMapSchema.parse(JSON.parse(await readFile(path.join(paths.runtimeRoot, 'repository-maps', mapFiles[0]!), 'utf8')));
});
it('handles workspace packages, malformed manifests and non-Node code without inventing entries', async () => {
  await file('package.json', '{"workspaces":["apps/*"]}'); await file('apps/web/package.json', '{"exports":"./index.js"}'); await file('apps/web/index.js', 'export default 1;'); await file('apps/broken/package.json', '{broken'); await file('tools/run.py', 'print(1)'); commit();
  await buildRepositoryMap(paths, 'sample-app');
  const packages = await getRepositoryMap(paths, { repo_id: 'sample-app', section: 'packages', path_prefix: 'apps/' }); expect(packages.items.map((i) => i.path)).toEqual(['apps/web/package.json']); expect(packages.warnings.join(' ')).toContain('Malformed');
  const languages = await getRepositoryMap(paths, { repo_id: 'sample-app', section: 'languages' }); expect(languages.items.some((i) => i.label === 'Python')).toBe(true);
});
it('excludes sensitive/generated/binary/oversized files and unsafe entry paths', async () => {
  await file('.env', 'private'); await file('credentials.json', 'private'); await file('dist/main.js', 'generated'); await file('binary.ts', Buffer.from([0, 1, 2])); await file('large.ts', 'x'.repeat(1024 * 1024 + 1)); await file('package.json', '{"main":"../../escape.ts"}'); commit();
  const built = await buildRepositoryMap(paths, 'sample-app'); expect(built.mapped_files).toBe(1);
  expect((await getRepositoryMap(paths, { repo_id: 'sample-app', section: 'entry_points' })).items).toEqual([]);
});
it('reports dirty, changed HEAD and removed source evidence; explicit rebuild handles rename/deletion', async () => {
  await file('old.py', 'print(1)'); const previous = commit(); await buildRepositoryMap(paths, 'sample-app'); await file('old.py', 'print(2)');
  expect((await getRepositoryMap(paths, { repo_id: 'sample-app' })).freshness.dirty_worktree).toBe(true);
  git('mv', 'old.py', 'new.py'); commit(); expect((await getRepositoryMap(paths, { repo_id: 'sample-app' })).freshness.head_changed).toBe(true);
  await buildRepositoryMap(paths, 'sample-app', previous); expect((await getRepositoryMap(paths, { repo_id: 'sample-app', section: 'files' })).items[0]?.path).toBe('old.py');
  await buildRepositoryMap(paths, 'sample-app'); expect((await getRepositoryMap(paths, { repo_id: 'sample-app', section: 'files' })).items[0]?.path).toBe('new.py');
  await rm(path.join(source, '.git'), { recursive: true }); expect((await getRepositoryMap(paths, { repo_id: 'sample-app' })).freshness.source_available).toBe(false);
});
it('enforces allowlist, missing-map errors, pagination, invalid cursors and byte budgets', async () => {
  await expect(getRepositoryMap(paths, { repo_id: 'hidden' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await expect(getRepositoryMap(paths, { repo_id: 'sample-app' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await file('a.py', 'print(1)'); await file('b.py', 'print(2)'); commit(); await buildRepositoryMap(paths, 'sample-app');
  const first = await getRepositoryMap(paths, { repo_id: 'sample-app', section: 'files', limit: 1 });
  const second = await getRepositoryMap(paths, { repo_id: 'sample-app', section: 'files', limit: 1, cursor: first.next_cursor }); expect(second.items[0]?.path).toBe('b.py'); expect(second.next_cursor).toBeNull();
  await expect(getRepositoryMap(paths, { repo_id: 'sample-app', cursor: first.next_cursor })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  await buildRepositoryMap(paths, 'sample-app'); await expect(getRepositoryMap(paths, { repo_id: 'sample-app', section: 'files', limit: 1, cursor: first.next_cursor })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  paths.config.budgets.maxBytes = 100; await expect(getRepositoryMap(paths, { repo_id: 'sample-app' })).rejects.toMatchObject({ code: 'CONTEXT_BUDGET_EXCEEDED' });
});
