import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { KnowledgeApplication, captureOutput, deliveryOutput, errorOutput, retrievalOutput, setupOutput } from '../../src/application/index.js';
import { resolvePaths, type ResolvedPaths } from '../../src/core/config.js';
import { buildActiveGeneration } from '../../src/indexing/build-index.js';
import { KnowledgeService } from '../../src/retrieval/service.js';

let root: string;
let paths: ResolvedPaths;
let consumer: KnowledgeApplication;
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'knowledge-application-'));
  await mkdir(path.join(root, 'schemas'));
  await copyFile('schemas/knowledge.schema.json', path.join(root, 'schemas/knowledge.schema.json'));
  await mkdir(path.join(root, 'knowledge'));
  paths = await resolvePaths({ root });
  paths.config.repositories = [{ id: 'fictional-app', name: 'Fictional app', owner: 'local-owner', team: 'local', path: root, aliases: ['old-app'] }];
  consumer = new KnowledgeApplication(paths);
});
afterEach(async () => { vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }); });
const ref = { contract_version: 1, repo_id: 'old-app' };
const plan = () => ({ contract_version: 1, mode: 'plan', transport: 'stdio', repository: { id: 'fictional-app', path: root, owner: 'local-owner', team: 'local' } });

it('rejects incompatible versions and injected authority before any writes', async () => {
  for (const method of ['setup', 'readiness', 'retrieve', 'prepareDelivery', 'capture'] as const) {
    await expect(consumer[method]({ contract_version: 2 })).rejects.toMatchObject({ detail: { code: 'UNSUPPORTED_VERSION', retryable: false } });
  }
  await expect(consumer.capture({ ...ref, principal: 'admin', outcome: 'no-learning' })).rejects.toMatchObject({ detail: { code: 'VALIDATION_ERROR' } });
  await expect(readFile(paths.configPath)).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(readFile(path.join(paths.runtimeRoot, 'receipts.sqlite'))).rejects.toMatchObject({ code: 'ENOENT' });
});

it('plans setup without mutation, rejects apply and configuration conflicts', async () => {
  expect(setupOutput.parse(await consumer.setup(plan())).state).toBe('planned');
  await expect(consumer.setup({ ...plan(), mode: 'apply' })).rejects.toMatchObject({ detail: { code: 'CAPABILITY_UNAVAILABLE' } });
  await expect(consumer.setup({ ...plan(), repository: { ...plan().repository, owner: 'other' } })).rejects.toMatchObject({ detail: { code: 'CONFLICT' } });
  await expect(consumer.setup({ ...plan(), transport: 'http' })).rejects.toMatchObject({ detail: { code: 'VALIDATION_ERROR' } });
  await expect(readFile(paths.configPath)).rejects.toMatchObject({ code: 'ENOENT' });
});

it('resolves aliases, denies unregistered identities, and detects ambiguity', async () => {
  expect(await consumer.readiness(ref)).toMatchObject({ repo_id: 'fictional-app', state: 'registered', context_delivery_verified: false });
  await expect(consumer.readiness({ ...ref, repo_id: 'hidden' })).rejects.toMatchObject({ detail: { code: 'NOT_FOUND' } });
  paths.config.repositories.push({ ...paths.config.repositories[0]!, id: 'other' });
  await expect(consumer.readiness(ref)).rejects.toMatchObject({ detail: { code: 'CONFLICT' } });
});

it('does not create an index during retrieval and returns retryable unavailable errors', async () => {
  try { await consumer.retrieve({ ...ref, task: 'inspect' }); throw new Error('Expected failure'); }
  catch (error) { expect(errorOutput.parse((error as { detail: unknown }).detail)).toMatchObject({ code: 'INDEX_UNAVAILABLE', retryable: true }); }
  await expect(readFile(path.join(paths.runtimeRoot, 'knowledge.sqlite'))).rejects.toMatchObject({ code: 'ENOENT' });
});

it('a fictional consumer retrieves context and prepares delivery without claiming consumption', async () => {
  await buildActiveGeneration(root, paths.runtimeRoot);
  expect(await consumer.readiness(ref)).toMatchObject({ state: 'index-available', context_delivery_verified: false });
  const result = retrievalOutput.parse(await consumer.retrieve({ ...ref, task: 'inspect' }));
  expect(result.context.results).toEqual([]);
  const delivery = deliveryOutput.parse(await consumer.prepareDelivery({ ...ref, task: 'inspect', task_id: 'task-1' }));
  expect(delivery).toMatchObject({ state: 'prepared', consumed: false, repo_id: 'fictional-app' });
  expect(JSON.stringify(delivery)).not.toContain(root);
});

it('rejects malformed readiness manifests without exposing filesystem details', async () => {
  await mkdir(paths.runtimeRoot);
  await writeFile(path.join(paths.runtimeRoot, 'index-active.json'), '{broken');
  await expect(consumer.readiness(ref)).rejects.toMatchObject({ detail: { code: 'INDEX_UNAVAILABLE', retryable: true } });
});

it('rejects invalid service outputs and sanitizes unexpected internal errors', async () => {
  await buildActiveGeneration(root, paths.runtimeRoot);
  const spy = vi.spyOn(KnowledgeService.prototype, 'taskContext');
  spy.mockResolvedValueOnce({} as Awaited<ReturnType<KnowledgeService['taskContext']>>);
  await expect(consumer.retrieve({ ...ref, task: 'inspect' })).rejects.toMatchObject({ detail: { code: 'INTERNAL_ERROR', message: 'The service returned an invalid integration response.' } });
  spy.mockRejectedValueOnce(new Error('private credential at ' + root));
  try { await consumer.retrieve({ ...ref, task: 'inspect' }); throw new Error('Expected failure'); }
  catch (error) {
    const detail = errorOutput.parse((error as { detail: unknown }).detail);
    expect(detail.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(detail)).not.toMatch(/private credential|knowledge-application-/);
  }
});

it('invalid Markdown returns validation failure before a candidate ledger is created', async () => {
  await expect(consumer.capture({ ...ref, outcome: 'learning', idempotency_key: 'invalid', markdown: 'not front matter' })).rejects.toMatchObject({ detail: { code: 'VALIDATION_ERROR' } });
  await expect(readFile(path.join(paths.runtimeRoot, 'receipts.sqlite'))).rejects.toMatchObject({ code: 'ENOENT' });
});

it('bounds request fields, paths and UTF-8 capture bytes', async () => {
  await expect(consumer.retrieve({ ...ref, task: 'x'.repeat(8001) })).rejects.toMatchObject({ detail: { code: 'VALIDATION_ERROR' } });
  await expect(consumer.retrieve({ ...ref, task: 'inspect', changed_paths: ['../private'] })).rejects.toMatchObject({ detail: { code: 'VALIDATION_ERROR' } });
  await expect(consumer.capture({ ...ref, outcome: 'learning', idempotency_key: 'key', markdown: '界'.repeat(22000) })).rejects.toMatchObject({ detail: { code: 'VALIDATION_ERROR' } });
  expect(captureOutput.parse(await consumer.capture({ ...ref, outcome: 'no-learning' }))).toMatchObject({ state: 'no-learning', durable: false });
});

it('captures and replays a schema-valid fictional learning without leaking candidate paths', async () => {
  const markdown = `---\nschema_version: 1\nid: fictional.learning\ntitle: Fictional learning\nsummary: Synthetic integration fixture.\ntype: practice\nscope:\n  kind: repo\n  repo_id: fictional-app\nstatus: candidate\nowner: local-owner\nsources: []\nrelationships: []\ncreated_at: "2026-10-13T00:00:00Z"\nupdated_at: "2026-10-13T00:00:00Z"\n---\nSynthetic body.\n`;
  const request = { ...ref, outcome: 'learning', idempotency_key: 'fictional-task', markdown };
  const first = captureOutput.parse(await consumer.capture(request));
  expect(first).toMatchObject({ state: 'candidate', duplicate: false });
  expect(await consumer.capture(request)).toMatchObject({ state: 'candidate', duplicate: true });
  expect(JSON.stringify(first)).not.toContain(root);
  await expect(consumer.capture({ ...request, markdown: markdown + 'changed' })).rejects.toMatchObject({ detail: { code: 'CONFLICT' } });
});
