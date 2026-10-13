import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';
import { stringify } from 'yaml';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { buildActiveGeneration } from '../../src/indexing/build-index.js';
import { resolvePaths, saveLocalConfig, type ResolvedPaths } from '../../src/core/config.js';
import { KnowledgeService } from '../../src/retrieval/service.js';
import { listRepositories } from '../../src/retrieval/repositories.js';
import { KnowledgeApplication } from '../../src/application/service.js';
import { buildRepositoryMap, getRepositoryMap } from '../../src/retrieval/repository-map.js';
import { startSession } from '../../src/capture/session.js';

const changes = vi.hoisted(() => ({ file: '', replacement: '', triggered: false, advanceHead: false, transientSchema: false, schemaReads: 0 }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, readFile: async (...args: Parameters<typeof actual.readFile>) => {
    const value = await actual.readFile(...args);
    if (changes.transientSchema && String(args[0]) === changes.file) {
      if (++changes.schemaReads === 2) return changes.replacement;
      return value;
    }
    if (!changes.triggered && String(args[0]) === changes.file) {
      changes.triggered = true; await actual.writeFile(changes.file, changes.replacement);
      if (changes.advanceHead) execFileSync('git', ['-C', path.dirname(path.dirname(changes.file)), '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-m', 'Synthetic concurrent HEAD change'], { stdio: 'ignore' });
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
afterEach(async () => { changes.file = ''; changes.triggered = false; changes.advanceHead = false; changes.transientSchema = false; changes.schemaReads = 0; await rm(root, { recursive: true, force: true }); });
async function snapshot(result: unknown) { return (result as any).knowledge_snapshot; }
it('stores a complete immutable clean snapshot manifest', async () => {
  git('init'); const revision = commit(); const built = await buildActiveGeneration(root, paths.runtimeRoot);
  const result = await service.search('Synthetic', 'sample');
  expect(await snapshot(result)).toMatchObject({ manifest_version: 2, schema_version: 1, indexer_version: 'knowledge-2', generation: built.generation, knowledge_commit: revision, source_state: 'clean' });
  const db = new DatabaseSync(path.join(paths.runtimeRoot, 'index-generations', built.generation + '.sqlite'));
  try { expect(db.prepare('SELECT record_count FROM index_manifest').get()?.record_count).toBe(1); } finally { db.close(); }
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
it('public snapshot metadata does not disclose counts of inaccessible records', async () => {
  await writeFile(path.join(root, 'knowledge', 'private.md'), markdown().replace('id: sample.overview', 'id: private.overview').replace('repo_id: sample', 'repo_id: private'));
  await buildActiveGeneration(root, paths.runtimeRoot);
  const result = await service.search('Synthetic', 'sample');
  expect(result.results).toHaveLength(1);
  expect(await snapshot(result)).not.toHaveProperty('record_count');
});
it('maps and prepared session receipts distinguish indexed knowledge from source revision', async () => {
  git('init'); const indexedRevision = commit(); await buildActiveGeneration(root, paths.runtimeRoot);
  await writeFile(filename(), markdown('Synthetic next source state.')); const sourceRevision = commit();
  await buildRepositoryMap(paths, 'sample');
  const map = await getRepositoryMap(paths, { repo_id: 'sample' });
  expect((map as any).knowledge_snapshot.knowledge_commit).toBe(indexedRevision);
  expect(map.source_revision).toBe(sourceRevision);
  const taskFile = path.join(root, 'task.txt'); await writeFile(taskFile, 'Synthetic');
  const receipt = await startSession(paths, { repoId: 'sample', agent: 'codex', taskFile, prepareOnly: true });
  expect(receipt.source_revision).toBe(sourceRevision);
  expect(receipt.context_receipt).toMatchObject({ knowledge_snapshot: { knowledge_commit: indexedRevision }, application_source: { repo_id: 'sample', requested_revision: sourceRevision } });
});
it('corrupt Git metadata yields an explicitly fingerprinted build without a false commit', async () => {
  await mkdir(path.join(root, '.git')); await writeFile(path.join(root, '.git', 'HEAD'), 'invalid');
  await buildActiveGeneration(root, paths.runtimeRoot);
  const result = await service.search('Synthetic', 'sample');
  expect(await snapshot(result)).toMatchObject({ knowledge_commit: null, source_state: 'git_unavailable' });
  expect(result.knowledge_revision).toMatch(/^git_unavailable:/);
  expect((result as any).checkout_drift).toMatchObject({ state: 'unavailable', head_changed: null });
});
it('schema changes produce drift and inconsistent manifest metadata is rejected', async () => {
  const built = await buildActiveGeneration(root, paths.runtimeRoot);
  const schemaFile = path.join(root, 'schemas/knowledge.schema.json'); await writeFile(schemaFile, (await readFile(schemaFile, 'utf8')) + '\n');
  expect((await service.search('Synthetic', 'sample') as any).checkout_drift.content_changed).toBe(true);
  const db = new DatabaseSync(path.join(paths.runtimeRoot, 'index-generations', built.generation + '.sqlite'));
  db.exec('UPDATE index_manifest SET record_count = 999'); db.close();
  await expect(service.search('Synthetic', 'sample')).rejects.toMatchObject({ code: 'INDEX_UNAVAILABLE' });
});
it('historical HEAD changes with identical content are distinguishable from content drift', async () => {
  git('init'); const first = commit(); await buildActiveGeneration(root, paths.runtimeRoot);
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-m', 'Synthetic unrelated commit');
  const later = git('rev-parse', 'HEAD');
  const result = await service.related('sample.overview', 'sample');
  expect(result.knowledge_revision).toBe(first);
  expect((result as any).checkout_drift).toMatchObject({ state: 'changed', head_revision: later, head_changed: true, content_changed: false });
});
it('CLI status and onboarding reports use indexed provenance rather than live HEAD', async () => {
  await copyFile('package.json', path.join(root, 'package.json'));
  git('init'); const indexedRevision = commit(); await saveLocalConfig(paths, paths.config); await buildActiveGeneration(root, paths.runtimeRoot);
  await writeFile(filename(), markdown('Synthetic newer checkout.')); const currentRevision = commit();
  const command = (args: string[]) => JSON.parse(execFileSync(process.execPath, [path.resolve('dist/cli.js'), '--root', root, ...args], { encoding: 'utf8', env: { ...process.env, CODEX_COMMAND: 'no-client-provenance-fixture' } }));
  const status = command(['status']);
  expect(status.knowledge_revision).toBe(indexedRevision);
  expect(status.checkout_revision).toBe(currentRevision);
  const report = command(['onboard', '--repo', 'sample', '--path', root, '--agent', 'codex', '--dry-run']);
  expect(report.knowledge_snapshot.knowledge_commit).toBe(indexedRevision);
  expect(report.source_revision).toBe(currentRevision);
});
it('changed schemas are actually recompiled on rebuild rather than cached by pathname', async () => {
  await buildActiveGeneration(root, paths.runtimeRoot);
  const schemaFile = path.join(root, 'schemas/knowledge.schema.json');
  const schema = JSON.parse(await readFile(schemaFile, 'utf8')); schema.properties.summary.maxLength = 3;
  await writeFile(schemaFile, JSON.stringify(schema));
  await expect(buildActiveGeneration(root, paths.runtimeRoot)).rejects.toMatchObject({ code: 'INDEX_VALIDATION_FAILED' });
});
it('the primary application revision is never applied to another repository source', async () => {
  git('init'); const primary = commit();
  const other = path.join(root, 'other-source'); await mkdir(other);
  execFileSync('git', ['init', other], { stdio: 'ignore' });
  await writeFile(path.join(other, 'example.ts'), 'export const synthetic = true;\n');
  execFileSync('git', ['-C', other, 'add', '.'], { stdio: 'ignore' });
  execFileSync('git', ['-C', other, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'Synthetic external source'], { stdio: 'ignore' });
  const revision = execFileSync('git', ['-C', other, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  paths.config.repositories.push({ id: 'other', name: 'Other', owner: 'local-owner', team: 'local', path: other, aliases: [] });
  const body = markdown().replace('kind: documentation\n    reference: fictional-only', `kind: code\n    repo_id: other\n    commit: ${revision}\n    path: example.ts`);
  await writeFile(filename(), body); await buildActiveGeneration(root, paths.runtimeRoot);
  const context = await service.taskContext({ repo_id: 'sample', task: 'Synthetic', source_revision: primary });
  expect(context.results[0]?.freshness).toBe('revision_not_checked');
});
it('HEAD changes during capture abort the build even when record bytes stay identical', async () => {
  git('init'); commit(); const good = await buildActiveGeneration(root, paths.runtimeRoot);
  changes.file = filename(); changes.replacement = markdown(); changes.advanceHead = true;
  await expect(buildActiveGeneration(root, paths.runtimeRoot)).rejects.toMatchObject({ code: 'INDEX_SOURCE_CHANGED' });
  expect(JSON.parse(await readFile(path.join(paths.runtimeRoot, 'index-active.json'), 'utf8')).generation).toBe(good.generation);
});
it('line-ending normalization and Unicode paths have deterministic fingerprints', async () => {
  const unicode = path.join(root, 'knowledge', '界 example.md');
  await writeFile(unicode, markdown().replace('id: sample.overview', 'id: sample.second'));
  git('init'); commit(); await buildActiveGeneration(root, paths.runtimeRoot);
  const first = await snapshot(await service.search('Synthetic', 'sample'));
  expect(first.source_state).toBe('clean');
  await writeFile(unicode, (await readFile(unicode, 'utf8')).replaceAll('\n', '\r\n'));
  await buildActiveGeneration(root, paths.runtimeRoot);
  expect((await snapshot(await service.search('Synthetic', 'sample'))).content_fingerprint).toBe(first.content_fingerprint);
});
it('validation uses captured schema bytes even if a later schema read briefly differs', async () => {
  changes.file = path.join(root, 'schemas/knowledge.schema.json');
  const schema = JSON.parse(await readFile(changes.file, 'utf8')); changes.replacement = JSON.stringify(schema);
  schema.properties.summary.maxLength = 3; await writeFile(changes.file, JSON.stringify(schema));
  changes.transientSchema = true;
  await expect(buildActiveGeneration(root, paths.runtimeRoot)).rejects.toMatchObject({ code: 'INDEX_VALIDATION_FAILED' });
});
