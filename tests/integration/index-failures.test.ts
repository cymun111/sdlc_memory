import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { stringify } from 'yaml';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { buildActiveGeneration } from '../../src/indexing/build-index.js';
import { resolvePaths, type ResolvedPaths } from '../../src/core/config.js';
import { KnowledgeService } from '../../src/retrieval/service.js';
import { KnowledgeApplication } from '../../src/application/service.js';
import { createMcpServer } from '../../src/mcp/server.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { validateKnowledgeTree } from '../../src/validation/validate-tree.js';
import { openIndex } from '../../src/indexing/database.js';

const faults = vi.hoisted(() => ({ readDirectory: '', readRecord: '', switchManifest: false }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual,
    readFile: (...args: Parameters<typeof actual.readFile>) => {
      if (String(args[0]) === faults.readRecord) return Promise.reject(Object.assign(new Error('private file failure'), { code: 'EACCES' }));
      return actual.readFile(...args);
    },
    readdir: (...args: Parameters<typeof actual.readdir>) => {
      if (String(args[0]) === faults.readDirectory) return Promise.reject(Object.assign(new Error('private denied path'), { code: 'EACCES' }));
      return actual.readdir(...args);
    },
    rename: (...args: Parameters<typeof actual.rename>) => {
      if (faults.switchManifest && String(args[1]).endsWith('index-active.json')) throw new Error('private switch failure');
      return actual.rename(...args);
    }
  };
});
let root: string;
let paths: ResolvedPaths;
let service: KnowledgeService;
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'safe-index-'));
  await mkdir(path.join(root, 'schemas'));
  await copyFile('schemas/knowledge.schema.json', path.join(root, 'schemas/knowledge.schema.json'));
  await mkdir(path.join(root, 'knowledge'));
  paths = await resolvePaths({ root });
  paths.config.repositories = [{ id: 'sample', name: 'Sample', owner: 'local-owner', team: 'local', path: root, aliases: [] }];
  service = new KnowledgeService(paths);
});
afterEach(async () => {
  faults.readDirectory = ''; faults.readRecord = ''; faults.switchManifest = false;
  await rm(root, { recursive: true, force: true });
});
async function record(id = 'sample.first', relationships: Array<{ type: string; target: string }> = [], extras: object = {}) {
  const body = '---\n' + stringify({ schema_version: 1, id, title: 'Synthetic record', summary: 'Synthetic searchable example.', type: 'practice', scope: { kind: 'repo', repo_id: 'sample' }, status: 'verified', owner: 'local-owner', sources: [], relationships, created_at: '2026-10-13T00:00:00Z', updated_at: '2026-10-13T00:00:00Z', ...extras }) + '---\nSynthetic body.\n';
  await writeFile(path.join(root, 'knowledge', id + '.md'), body);
}
async function baseline() { await record(); return buildActiveGeneration(root, paths.runtimeRoot); }
async function activeDatabase() {
  const active = JSON.parse(await readFile(path.join(paths.runtimeRoot, 'index-active.json'), 'utf8')) as { database: string };
  return new DatabaseSync(path.join(paths.runtimeRoot, active.database));
}
async function preserved(generation: string) {
  expect(JSON.parse(await readFile(path.join(paths.runtimeRoot, 'index-active.json'), 'utf8')).generation).toBe(generation);
  expect((await service.search('Synthetic', 'sample')).results[0]?.id).toBe('sample.first');
}

it('requires an existing index for every read and never creates an empty fallback database', async () => {
  for (const action of [() => service.search('Synthetic', 'sample'), () => service.taskContext({ repo_id: 'sample', task: 'Synthetic' }), () => service.get('sample.first', 'sample'), () => service.related('sample.first', 'sample')]) {
    await expect(action()).rejects.toMatchObject({ code: 'INDEX_UNAVAILABLE' });
  }
  await expect(readFile(path.join(paths.runtimeRoot, 'knowledge.sqlite'))).rejects.toMatchObject({ code: 'ENOENT' });
});
it('an existing empty knowledge directory is valid, while a missing required directory is not', async () => {
  expect((await buildActiveGeneration(root, paths.runtimeRoot)).recordCount).toBe(0);
  await rm(path.join(root, 'knowledge'), { recursive: true });
  await expect(buildActiveGeneration(root, paths.runtimeRoot)).rejects.toMatchObject({ code: 'INDEX_SOURCE_UNAVAILABLE' });
});
it('nested directory read failure preserves the last good generation and reports safe degraded state', async () => {
  const good = await baseline();
  const nested = path.join(root, 'knowledge', 'nested'); await mkdir(nested);
  faults.readDirectory = nested;
  await expect(buildActiveGeneration(root, paths.runtimeRoot)).rejects.toMatchObject({ code: 'INDEX_SOURCE_UNAVAILABLE' });
  faults.readDirectory = '';
  await preserved(good.generation);
  const state = JSON.parse(await readFile(path.join(paths.runtimeRoot, 'index-build-status.json'), 'utf8'));
  expect(state).toMatchObject({ state: 'degraded', error: { code: 'INDEX_SOURCE_UNAVAILABLE' } });
  expect(JSON.stringify(state)).not.toContain(root);
});
it.each([
  ['unresolved relationship', async () => record('sample.bad', [{ type: 'related-to', target: 'hidden.private' }])],
  ['invalid relationship type', async () => record('sample.bad', [{ type: 'execute', target: 'sample.first' }])],
  ['supersedes edge cycle', async () => { await record('sample.first', [{ type: 'supersedes', target: 'sample.second' }]); await record('sample.second', [{ type: 'supersedes', target: 'sample.first' }]); }],
  ['supersedes metadata cycle', async () => { await record('sample.first', [], { supersedes: ['sample.second'] }); await record('sample.second', [], { supersedes: ['sample.first'] }); }],
  ['duplicate record ID', async () => { await record('sample.second', [], { id: 'sample.first' }); }],
  ['malformed record', async () => writeFile(path.join(root, 'knowledge', 'bad.md'), 'invalid')]
])('rejects %s without switching or retaining failed staging files', async (_name, damage) => {
  const good = await baseline(); await damage();
  await expect(buildActiveGeneration(root, paths.runtimeRoot)).rejects.toMatchObject({ code: 'INDEX_VALIDATION_FAILED' });
  await preserved(good.generation);
  expect((await readdir(path.join(paths.runtimeRoot, 'index-generations'))).filter((file) => file.includes('.staging'))).toEqual([]);
});
it('permits related-to cycles and supersession pointing at retained historical records', async () => {
  await record('sample.first', [{ type: 'related-to', target: 'sample.second' }]);
  await record('sample.second', [{ type: 'related-to', target: 'sample.first' }], { status: 'superseded' });
  expect((await buildActiveGeneration(root, paths.runtimeRoot)).recordCount).toBe(2);
});
it('switch failure preserves the active index, cleans only its attempted artifacts, and is recoverable', async () => {
  const good = await baseline(); faults.switchManifest = true;
  await expect(buildActiveGeneration(root, paths.runtimeRoot)).rejects.toMatchObject({ code: 'INDEX_BUILD_FAILED' });
  faults.switchManifest = false;
  await preserved(good.generation);
  expect((await readdir(path.join(paths.runtimeRoot, 'index-generations'))).filter((file) => file.endsWith('.sqlite'))).toEqual([good.generation + '.sqlite']);
  await buildActiveGeneration(root, paths.runtimeRoot);
  expect(JSON.parse(await readFile(path.join(paths.runtimeRoot, 'index-build-status.json'), 'utf8')).state).toBe('ready');
});
it('reports broken FTS as a query error instead of successful empty context', async () => {
  await baseline(); const db = await activeDatabase(); db.exec('DROP TABLE record_search'); db.close();
  await expect(service.taskContext({ repo_id: 'sample', task: 'Synthetic' })).rejects.toMatchObject({ code: 'INDEX_QUERY_FAILED' });
  await expect(service.search('Synthetic', 'sample')).rejects.toMatchObject({ code: 'INDEX_QUERY_FAILED' });
});
it('rejects corrupt databases and malformed manifests with sanitized unavailable errors', async () => {
  const good = await baseline();
  await writeFile(path.join(paths.runtimeRoot, 'index-generations', good.generation + '.sqlite'), 'corrupt');
  await expect(service.search('Synthetic', 'sample')).rejects.toMatchObject({ code: 'INDEX_UNAVAILABLE' });
  await writeFile(path.join(paths.runtimeRoot, 'index-active.json'), '{broken');
  await expect(service.search('Synthetic', 'sample')).rejects.toMatchObject({ code: 'INDEX_UNAVAILABLE' });
});
it('successful no-match searches stay successful empty results', async () => {
  await baseline();
  expect((await service.taskContext({ repo_id: 'sample', task: 'nonexistent' })).results).toEqual([]);
});
it('validation reports unavailable required directories and unresolved graphs', async () => {
  await record('sample.first', [{ type: 'related-to', target: 'missing.record' }]);
  expect(await validateKnowledgeTree(root)).toEqual(expect.arrayContaining([expect.objectContaining({ message: expect.stringMatching(/relationship|reference/i) })]));
  faults.readDirectory = path.join(root, 'knowledge');
  expect(await validateKnowledgeTree(root)).toEqual(expect.arrayContaining([expect.objectContaining({ message: expect.stringMatching(/unavailable/i) })]));
});
it('record read failures preserve the last-good index', async () => {
  const good = await baseline(); faults.readRecord = path.join(root, 'knowledge', 'sample.first.md');
  await expect(buildActiveGeneration(root, paths.runtimeRoot)).rejects.toMatchObject({ code: 'INDEX_SOURCE_UNAVAILABLE' });
  faults.readRecord = ''; await preserved(good.generation);
});
it('rejects active manifest path escapes and generation mismatches', async () => {
  await baseline();
  const filename = path.join(paths.runtimeRoot, 'index-active.json');
  const manifest = JSON.parse(await readFile(filename, 'utf8'));
  await writeFile(filename, JSON.stringify({ ...manifest, generation: 'wrong-generation' }));
  await expect(service.search('Synthetic', 'sample')).rejects.toMatchObject({ code: 'INDEX_UNAVAILABLE' });
  await writeFile(filename, JSON.stringify({ ...manifest, database: '../private.sqlite' }));
  await expect(service.search('Synthetic', 'sample')).rejects.toMatchObject({ code: 'INDEX_UNAVAILABLE' });
});

it('an SDK client receives distinct missing-index and query errors with no private metadata', async () => {
  const client = new Client({ name: 'failure-fixture', version: '1' });
  const server = createMcpServer(paths);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport); await client.connect(clientTransport);
    const missing = await client.callTool({ name: 'get_task_context', arguments: { repo_id: 'sample', task: 'Synthetic' } });
    expect(missing.isError).toBe(true);
    expect(missing.structuredContent).toMatchObject({ ok: false, data: { error: { code: 'INDEX_UNAVAILABLE' } } });
    await baseline(); const db = await activeDatabase(); db.exec('DROP TABLE record_search'); db.close();
    const failed = await client.callTool({ name: 'get_task_context', arguments: { repo_id: 'sample', task: 'Synthetic' } });
    expect(failed.structuredContent).toMatchObject({ ok: false, data: { error: { code: 'INDEX_QUERY_FAILED' } } });
    expect(JSON.stringify(failed)).not.toMatch(/safe-index-|record_search/);
  } finally { await client.close(); await server.close(); }
});
it('the application facade preserves the query-failure code and retry guidance', async () => {
  await baseline(); const db = await activeDatabase(); db.exec('DROP TABLE record_search'); db.close();
  await expect(new KnowledgeApplication(paths).retrieve({ contract_version: 1, repo_id: 'sample', task: 'Synthetic' })).rejects.toMatchObject({ detail: { code: 'INDEX_QUERY_FAILED', retryable: true } });
});
it('corrupt indexed metadata returns a safe query error rather than raw parser diagnostics', async () => {
  await baseline(); const db = await activeDatabase();
  db.prepare('UPDATE records SET body = ?').run('---\nprivate-secret: [unterminated\n---\n'); db.close();
  await expect(service.get('sample.first', 'sample')).rejects.toMatchObject({ code: 'INDEX_QUERY_FAILED' });
});
it('active reader connections are read-only', async () => {
  await baseline(); const db = await openIndex(paths.runtimeRoot);
  try { expect(() => db.exec('DELETE FROM records')).toThrow(); } finally { db.close(); }
  expect((await service.search('Synthetic', 'sample')).results).toHaveLength(1);
});
it('transaction failure rolls back the staged build and preserves active readers', async () => {
  const good = await baseline();
  await record('sample.first', [{ type: 'related-to', target: 'sample.second' }, { type: 'related-to', target: 'sample.second' }]);
  await record('sample.second');
  await expect(buildActiveGeneration(root, paths.runtimeRoot)).rejects.toMatchObject({ code: 'INDEX_BUILD_FAILED' });
  await preserved(good.generation);
});
