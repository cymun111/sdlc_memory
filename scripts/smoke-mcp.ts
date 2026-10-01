import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stringify } from 'yaml';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { resolvePaths, registerRepository } from '../src/core/config.js';
import { buildActiveGeneration } from '../src/indexing/build-index.js';

// Synthetic records are confined to a disposable checkout, never real project evidence.
const checkout = fileURLToPath(new URL('../', import.meta.url));
const root = await mkdtemp(path.join(os.tmpdir(), 'knowledge-mcp-'));
const client = new Client({ name: 'engineering-knowledge-smoke', version: '0.1.0' });
function markdown(id: string, repoId: string, status = 'verified', related = false): string {
  return ['---', stringify({ schema_version: 1, id, title: 'Synthetic retrieval example', summary: 'Fictional smoke test data only.', type: 'observed-behavior', scope: { kind: 'repo', repo_id: repoId }, status, owner: 'test-owner', sources: [], relationships: related ? [{ type: 'related-to', target: 'test.second' }] : [], created_at: '2026-09-30T00:00:00Z', updated_at: '2026-09-30T00:00:00Z' }).trimEnd(), '---', 'Fictional smoke body.', ''].join('\n');
}
async function call(name: string, args: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: args });
  assert.ok(!result.isError, JSON.stringify(result));
  const envelope = result.structuredContent as { ok: boolean; data: Record<string, any> };
  assert.equal(envelope.ok, true);
  return envelope.data;
}
try {
  await mkdir(path.join(root, 'schemas'));
  await copyFile(path.join(checkout, 'schemas/knowledge.schema.json'), path.join(root, 'schemas/knowledge.schema.json'));
  await mkdir(path.join(root, 'knowledge'));
  const source = path.join(root, 'source');
  await mkdir(source);
  execFileSync('git', ['init', source], { stdio: 'ignore' });
  await writeFile(path.join(source, 'package.json'), JSON.stringify({ main: 'main.js', scripts: { test: 'node --test' } }));
  await writeFile(path.join(source, 'main.js'), 'export const synthetic = true;\n');
  execFileSync('git', ['-C', source, 'add', '.'], { stdio: 'ignore' });
  execFileSync('git', ['-C', source, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'Synthetic map source'], { stdio: 'ignore' });
  const paths = await resolvePaths({ root });
  await registerRepository(paths, { id: 'test-app', repoPath: source, owner: 'test-owner', team: 'test-team' });
  execFileSync(process.execPath, [path.join(checkout, 'dist/cli.js'), '--root', root, 'repos', 'map', 'build', '--repo', 'test-app'], { stdio: 'pipe' });
  for (const [id, repo, related] of [['test.first', 'test-app', true], ['test.second', 'test-app', false], ['test.hidden', 'other-app', false]] as const) {
    await writeFile(path.join(root, 'knowledge', id + '.md'), markdown(id, repo, 'verified', related));
  }
  const active = await buildActiveGeneration(root, paths.runtimeRoot);
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(checkout, 'dist/cli.js'), '--root', root, 'serve', '--transport', 'stdio'], cwd: os.tmpdir(), stderr: 'pipe' }));
  const tools = await client.listTools();
  assert.deepEqual(new Set(tools.tools.map(({ name }) => name)), new Set(['get_repository_map', 'list_repositories', 'get_task_context', 'search_knowledge', 'get_knowledge', 'get_related', 'submit_learning', 'update_candidate', 'report_conflict']));
  const discovery = await call('list_repositories', { limit: 1 });
  assert.equal(discovery.repositories[0].id, 'test-app');
  const map = await call('get_repository_map', { repo_id: discovery.repositories[0].id, section: 'entry_points' });
  assert.equal(map.items[0].path, 'main.js');
  assert.equal(map.freshness.head_changed, false);
  const cliMap = JSON.parse(execFileSync(process.execPath, [path.join(checkout, 'dist/cli.js'), '--root', root, 'repos', 'map', 'show', '--repo', 'test-app', '--section', 'entry_points'], { encoding: 'utf8', cwd: os.tmpdir() }));
  assert.deepEqual(cliMap, map);
  assert.equal(discovery.repositories[0].description_status, 'unavailable');
  assert.ok(!JSON.stringify(discovery).includes(source));
  const cliDiscovery = JSON.parse(execFileSync(process.execPath, [path.join(checkout, 'dist/cli.js'), '--root', root, 'repos', 'list', '--limit', '1'], { encoding: 'utf8', cwd: os.tmpdir() }));
  assert.deepEqual(cliDiscovery, discovery);
  const context = await call('get_task_context', { repo_id: discovery.repositories[0].id, task: 'Synthetic' });
  assert.equal(context.status, 'ok');
  assert.equal(context.index_generation, active.generation);
  assert.deepEqual(new Set(context.results.map((record: { id: string }) => record.id)), new Set(['test.first', 'test.second']));
  assert.match((await call('get_knowledge', { id: 'test.first', repo_id: 'test-app' })).body, /Fictional smoke body/);
  assert.equal((await call('get_related', { id: 'test.first', repo_id: 'test-app' })).nodes[0].id, 'test.second');
  for (const args of [{ id: 'test.hidden', repo_id: 'test-app' }, { id: 'test.first', repo_id: 'unknown' }]) {
    assert.equal((await client.callTool({ name: 'get_knowledge', arguments: args })).isError, true);
  }
  const submission = { repo_id: 'test-app', idempotency_key: 'smoke:1', learning: { markdown: markdown('test.candidate', 'test-app', 'candidate') } };
  const receipt = await call('submit_learning', submission);
  assert.equal((await call('submit_learning', submission)).receipt_id, receipt.receipt_id);
  const edit = { repo_id: 'test-app', id: 'test.candidate', expected_hash: receipt.content_hash, learning: { markdown: submission.learning.markdown.replace('Fictional smoke body.', 'Corrected fictional smoke body.') } };
  const updated = await call('update_candidate', edit);
  assert.notEqual(updated.content_hash, receipt.content_hash);
  assert.equal(updated.state, 'candidate');
  const stale = await client.callTool({ name: 'update_candidate', arguments: edit });
  assert.equal(stale.isError, true);
  assert.equal((stale.structuredContent as { data: { error: { code: string } } }).data.error.code, 'CONFLICT');
  assert.equal((await call('submit_learning', submission)).content_hash, updated.content_hash);
  assert.equal((await client.callTool({ name: 'get_knowledge', arguments: { id: 'test.candidate' } })).isError, true);
  assert.equal((await call('search_knowledge', { query: 'Synthetic', repo_id: 'test-app' })).results.length, 2);
  console.log('MCP stdio passed: nine-tool discovery, repository discovery/map/CLI parity, context, reads, relationships, scope denial, generation identity, submission, update, stale-hash conflict and replay.');
} finally {
  await client.close();
  await rm(root, { recursive: true, force: true });
}
