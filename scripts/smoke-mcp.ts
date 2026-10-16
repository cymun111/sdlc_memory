import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
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
  assert.deepEqual(new Set(tools.tools.map(({ name }) => name)), new Set(['get_repository_map', 'list_repositories', 'get_task_context', 'search_knowledge', 'get_knowledge', 'get_related', 'submit_learning', 'update_candidate', 'report_conflict', 'list_candidates', 'get_candidate']));
  for (const name of ['list_candidates','get_candidate']) assert.equal(tools.tools.find(tool=>tool.name===name)?.annotations?.readOnlyHint,true);
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
  assert.equal(context.knowledge_snapshot.generation, active.generation);
  assert.equal(context.knowledge_snapshot.source_state, 'unversioned');
  assert.match(context.knowledge_snapshot.content_fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(context.checkout_drift.state, 'matched');
  assert.deepEqual(context.application_source, { repo_id: 'test-app', requested_revision: null });
  assert.deepEqual(discovery.knowledge_snapshot, context.knowledge_snapshot);
  assert.deepEqual(map.knowledge_snapshot, context.knowledge_snapshot);
  assert.ok(!('record_count' in context.knowledge_snapshot));
  assert.deepEqual(new Set(context.results.map((record: { id: string }) => record.id)), new Set(['test.first', 'test.second']));
  assert.match((await call('get_knowledge', { id: 'test.first', repo_id: 'test-app' })).body, /Fictional smoke body/);
  assert.equal((await call('get_related', { id: 'test.first', repo_id: 'test-app' })).nodes[0].id, 'test.second');
  for (const args of [{ id: 'test.hidden', repo_id: 'test-app' }, { id: 'test.first', repo_id: 'unknown' }]) {
    assert.equal((await client.callTool({ name: 'get_knowledge', arguments: args })).isError, true);
  }
  const submission = { repo_id: 'test-app', idempotency_key: 'smoke:1', learning: { markdown: markdown('test.candidate', 'test-app', 'candidate') } };
  const receipt = await call('submit_learning', submission);
  assert.equal((await call('submit_learning', submission)).receipt_id, receipt.receipt_id);
  const pending = await call('list_candidates', {repo_id:'test-app'});
  assert.deepEqual(pending.candidates.map((item:any)=>item.id),['test.candidate']);
  assert.ok(!JSON.stringify(pending).includes(root));
  const candidateInspection = await call('get_candidate',{repo_id:'test-app',id:pending.candidates[0].id,expected_hash:pending.candidates[0].content_hash});
  assert.equal(candidateInspection.markdown,submission.learning.markdown);
  assert.equal(candidateInspection.candidate.content_hash,receipt.content_hash);
  assert.ok(!JSON.stringify(candidateInspection).includes(root));
  const edit = { repo_id: 'test-app', id: 'test.candidate', expected_hash: candidateInspection.candidate.content_hash, learning: { markdown: candidateInspection.markdown.replace('Fictional smoke body.', 'Corrected fictional smoke body.') } };
  const updated = await call('update_candidate', edit);
  assert.notEqual(updated.content_hash, receipt.content_hash);
  assert.equal(updated.state, 'candidate');
  const stale = await client.callTool({ name: 'update_candidate', arguments: edit });
  assert.equal(stale.isError, true);
  assert.equal((stale.structuredContent as { data: { error: { code: string } } }).data.error.code, 'CONFLICT');
  const reinspected=await call('get_candidate',{repo_id:'test-app',id:'test.candidate'});
  assert.equal(reinspected.candidate.content_hash,updated.content_hash);
  assert.equal(reinspected.markdown,edit.learning.markdown);
  assert.equal((await call('submit_learning', submission)).content_hash, updated.content_hash);
  assert.equal((await client.callTool({ name: 'get_knowledge', arguments: { id: 'test.candidate' } })).isError, true);
  assert.equal((await call('search_knowledge', { query: 'Synthetic', repo_id: 'test-app' })).results.length, 2);
  const report = await call('report_conflict', { repo_id: 'test-app', record_ids: ['test.first', 'test.second'], explanation: 'Synthetic stdio report requiring owner review.' });
  assert.ok(!('path' in report));
  assert.ok((await call('get_task_context', { repo_id: 'test-app', task: 'Synthetic' })).unresolved_conflicts.includes(report.id));
  const inspected = JSON.parse(execFileSync(process.execPath, [path.join(checkout, 'dist/cli.js'), '--root', root, 'conflict', 'inspect', report.id, '--repo', 'test-app'], { encoding: 'utf8' }));
  execFileSync(process.execPath, [path.join(checkout, 'dist/cli.js'), '--root', root, 'conflict', 'resolve', report.id, '--repo', 'test-app', '--expected-hash', inspected.hash, '--reason', 'Owner reviewed the synthetic report.'], { stdio: 'pipe' });
  assert.deepEqual((await call('get_task_context', { repo_id: 'test-app', task: 'Synthetic' })).unresolved_conflicts, []);
  const policy = markdown('test.disputed-policy', 'test-app', 'disputed').replace('type: observed-behavior', 'type: approved-policy');
  await writeFile(path.join(root, 'knowledge', 'disputed-policy.md'), policy);
  await buildActiveGeneration(root, paths.runtimeRoot);
  const blocked = await call('get_task_context', { repo_id: 'test-app', task: 'Synthetic' });
  assert.equal(blocked.status, 'POLICY_REVIEW_REQUIRED');
  assert.ok(blocked.policy_issues.some((issue: { id: string; reason: string }) => issue.id === 'test.disputed-policy' && issue.reason === 'disputed'));
  const history = await call('get_knowledge', { id: 'test.disputed-policy', repo_id: 'test-app', include_history: true });
  assert.equal(history.record.normative, false);
  assert.equal(history.record.editorial_status, 'disputed');
  const activeManifest = JSON.parse(await readFile(path.join(paths.runtimeRoot, 'index-active.json'), 'utf8'));
  const database = new DatabaseSync(path.join(paths.runtimeRoot, activeManifest.database));
  database.exec('DROP TABLE record_search'); database.close();
  const queryFailure = await client.callTool({ name: 'get_task_context', arguments: { repo_id: 'test-app', task: 'Synthetic' } });
  assert.equal(queryFailure.isError, true);
  assert.equal((queryFailure.structuredContent as any).data.error.code, 'INDEX_QUERY_FAILED');
  assert.ok(!JSON.stringify(queryFailure).includes(root));
  await rm(path.join(paths.runtimeRoot, 'index-active.json'));
  const unavailable = await client.callTool({ name: 'search_knowledge', arguments: { repo_id: 'test-app', query: 'Synthetic' } });
  assert.equal(unavailable.isError, true);
  assert.equal((unavailable.structuredContent as any).data.error.code, 'INDEX_UNAVAILABLE');
  console.log('MCP stdio passed: eleven-tool discovery, scoped reads/provenance, candidate list/inspect/update/stale/reinspect/replay, conflict creation/owner resolution, historical inspection, policy-review blocking and explicit index failures.');
} finally {
  await client.close();
  await rm(root, { recursive: true, force: true });
}
