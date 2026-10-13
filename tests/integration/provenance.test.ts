import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';
import { stringify } from 'yaml';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { buildActiveGeneration } from '../../src/indexing/build-index.js';
import { resolvePaths, type ResolvedPaths } from '../../src/core/config.js';
import { KnowledgeService } from '../../src/retrieval/service.js';
import { listRepositories } from '../../src/retrieval/repositories.js';
import { KnowledgeApplication } from '../../src/application/service.js';

const changes = vi.hoisted(() => ({ file: '', replacement: '', triggered: false }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, readFile: async (...args: Parameters<typeof actual.readFile>) => {
    const value = await actual.readFile(...args);
    if (!changes.triggered && String(args[0]) === changes.file) {
      changes.triggered = true; await actual.writeFile(changes.file, changes.replacement);
    }
    return value;
  } };
});
let root: string;
let paths: ResolvedPaths;
let service: KnowledgeService;
const filename = () => path.join(root, 'knowledge', 'sample.md');
function git(...args: string[]) { return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
function commit() { git('add', 'knowledge', 'schemas', '.gitignore'); git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'Synthetic knowledge snapshot'); return git('rev-parse', 'HEAD'); }
function markdown(summary = 'Synthetic first overview.') { return '---\n' + stringify({ schema_version: 1, id: 'sample.overview', title: 'Synthetic overview', summary, type: 'overview', scope: { kind: 'repo', repo_id: 'sample' }, status: 'verified', owner: 'local-owner', sources: [{ kind: 'documentation', reference: 'fictional-only' }], relationships: [], created_at: '2026-10-13T00:00:00Z', updated_at: '2026-10-13T00:00:00Z' }) + '---\nSynthetic body.\n'; }
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'snapshot-provenance-'));
  await mkdir(path.join(root, 'schemas')); await copyFile('schemas/knowledge.schema.json', path.join(root, 'schemas/knowledge.schema.json'));
  await mkdir(path.join(root, 'knowledge')); await writeFile(filename(), markdown());
  await writeFile(path.join(root, '.gitignore'), '.runtime/\n');
  paths = await resolvePaths({ root });
  paths.config.repositories = [{ id: 'sample', name: 'Sample', owner: 'local-owner', team: 'local', path: root, aliases: [] }];
  service = new KnowledgeService(paths);
});
afterEach(async () => { changes.file = ''; changes.triggered = false; await rm(root, { recursive: true, force: true }); });
async function snapshot(result: unknown) { return (result as any).knowledge_snapshot; }
it('stores a complete immutable clean snapshot manifest', async () => {
  git('init'); const revision = commit(); const built = await buildActiveGeneration(root, paths.runtimeRoot);
  const result = await service.search('Synthetic', 'sample');
  expect(await snapshot(result)).toMatchObject({ manifest_version: 2, schema_version: 1, indexer_version: 'knowledge-2', generation: built.generation, knowledge_commit: revision, source_state: 'clean', record_count: 1 });
  expect((await snapshot(result)).content_fingerprint).toMatch(/^[a-f0-9]{64}$/);
  expect((await snapshot(result)).schema_fingerprint).toMatch(/^[a-f0-9]{64}$/);
  expect((await snapshot(result)).built_at).toMatch(/^\d{4}-/);
});
it('advancing HEAD changes drift but never relabels an older index', async () => {
  git('init'); const first = commit(); const built = await buildActiveGeneration(root, paths.runtimeRoot);
  await writeFile(filename(), markdown('Synthetic second overview.')); const second = commit();
  const result = await service.taskContext({ repo_id: 'sample', task: 'Synthetic', source_revision: second });
  expect(result.knowledge_revision).toBe(first);
  expect((result as any).knowledge_snapshot.generation).toBe(built.generation);
  expect((result as any).checkout_drift).toMatchObject({ state: 'changed', head_revision: second, head_changed: true, content_changed: true });
  expect(result.results[0]?.summary).toBe('Synthetic first overview.');
  expect((result as any).application_source).toEqual({ repo_id: 'sample', requested_revision: second });
});
it('uncommitted edits label a build dirty while preserving its actual content fingerprint', async () => {
  git('init'); const revision = commit(); await writeFile(filename(), markdown('Synthetic dirty overview.'));
  await buildActiveGeneration(root, paths.runtimeRoot);
  const result = await service.get('sample.overview', 'sample');
  expect(await snapshot(result)).toMatchObject({ knowledge_commit: revision, source_state: 'dirty' });
  expect(result.knowledge_revision).toBe('dirty:' + (await snapshot(result)).content_fingerprint);
  expect((result as any).checkout_drift.state).toBe('matched');
});
it('unversioned builds are fingerprinted and never attributed to a commit', async () => {
  await buildActiveGeneration(root, paths.runtimeRoot);
  const result = await service.search('Synthetic', 'sample');
  expect(await snapshot(result)).toMatchObject({ knowledge_commit: null, source_state: 'unversioned' });
  expect(result.knowledge_revision).toBe('unversioned:' + (await snapshot(result)).content_fingerprint);
});
it('fingerprints stay stable across rebuilds but change with record content', async () => {
  await buildActiveGeneration(root, paths.runtimeRoot); const first = await snapshot(await service.search('Synthetic', 'sample'));
  await buildActiveGeneration(root, paths.runtimeRoot); const second = await snapshot(await service.search('Synthetic', 'sample'));
  expect(second.content_fingerprint).toBe(first.content_fingerprint); expect(second.generation).not.toBe(first.generation);
  await writeFile(filename(), markdown('Synthetic changed overview.')); await buildActiveGeneration(root, paths.runtimeRoot);
  expect((await snapshot(await service.search('Synthetic', 'sample'))).content_fingerprint).not.toBe(first.content_fingerprint);
});
it('changes during a build abort switching and keep the prior generation usable', async () => {
  const good = await buildActiveGeneration(root, paths.runtimeRoot);
  changes.file = filename(); changes.replacement = markdown('Synthetic concurrent change.');
  await expect(buildActiveGeneration(root, paths.runtimeRoot)).rejects.toMatchObject({ code: 'INDEX_SOURCE_CHANGED' });
  expect(JSON.parse(await readFile(path.join(paths.runtimeRoot, 'index-active.json'), 'utf8')).generation).toBe(good.generation);
  expect((await service.search('Synthetic', 'sample')).results[0]?.summary).toBe('Synthetic first overview.');
});
it('live unavailable knowledge is reported as drift uncertainty without destroying indexed reads', async () => {
  await buildActiveGeneration(root, paths.runtimeRoot); await rm(path.join(root, 'knowledge'), { recursive: true });
  const result = await service.search('Synthetic', 'sample');
  expect(result.results).toHaveLength(1); expect((result as any).checkout_drift.state).toBe('unavailable');
});
it('discovery and facade readiness/delivery share the indexed snapshot identity', async () => {
  git('init'); const revision = commit(); await buildActiveGeneration(root, paths.runtimeRoot);
  const discovery = await listRepositories(paths);
  expect((discovery as any).knowledge_snapshot.knowledge_commit).toBe(revision);
  const app = new KnowledgeApplication(paths);
  expect((await app.readiness({ contract_version: 1, repo_id: 'sample' }) as any).knowledge_snapshot.knowledge_commit).toBe(revision);
  const delivery = await app.prepareDelivery({ contract_version: 1, repo_id: 'sample', task: 'Synthetic', task_id: 'task-1', source_revision: revision });
  expect((delivery.context as any).knowledge_snapshot.knowledge_commit).toBe(revision);
});
it('legacy generations without snapshot metadata require an explicit rebuild', async () => {
  const built = await buildActiveGeneration(root, paths.runtimeRoot);
  const db = new DatabaseSync(path.join(paths.runtimeRoot, 'index-generations', built.generation + '.sqlite'));
  const columns = db.prepare('PRAGMA table_info(index_manifest)').all();
  if (columns.some((column) => column.name === 'snapshot_json')) db.exec('UPDATE index_manifest SET snapshot_json = NULL');
  db.close();
  await expect(service.search('Synthetic', 'sample')).rejects.toMatchObject({ code: 'INDEX_REBUILD_REQUIRED' });
});
