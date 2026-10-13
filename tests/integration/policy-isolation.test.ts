import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { stringify } from 'yaml';
import { beforeEach, afterEach, expect, it } from 'vitest';
import { resolvePaths, saveLocalConfig, type ResolvedPaths } from '../../src/core/config.js';
import { buildActiveGeneration } from '../../src/indexing/build-index.js';
import { KnowledgeService } from '../../src/retrieval/service.js';
import { createConflictReport } from '../../src/capture/review.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../../src/mcp/server.js';
import * as conflictStore from '../../src/capture/conflicts.js';
import { createHash } from 'node:crypto';
import { KnowledgeApplication } from '../../src/application/service.js';
import { DatabaseSync } from 'node:sqlite';
import { vi } from 'vitest';

let root: string;
let paths: ResolvedPaths;
let service: KnowledgeService;
let revision: string;
const approval = { kind: 'decision', url: 'https://example.invalid/approved/1', approver: 'local-owner', approved_at: '2026-10-13T00:00:00Z' };
function git(...args: string[]) { return execFileSync('git', ['-C', path.join(root, 'source'), ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
async function record(id: string, extras: object = {}) {
  await writeFile(path.join(root, 'knowledge', id + '.md'), '---\n' + stringify({ schema_version: 1, id, title: 'Synthetic knowledge', summary: 'Synthetic safe summary.', type: 'practice', scope: { kind: 'repo', repo_id: 'alpha' }, status: 'verified', owner: 'local-owner', sources: [], relationships: [], created_at: '2026-10-13T00:00:00Z', updated_at: '2026-10-13T00:00:00Z', ...extras }) + '---\nSynthetic body.\n');
}
async function index() { return buildActiveGeneration(root, paths.runtimeRoot); }
async function context(options: object = {}) { return service.taskContext({ repo_id: 'alpha', task: 'Synthetic', ...options }); }
const code = () => ({ kind: 'code', repo_id: 'alpha', commit: revision, path: 'policy.ts' });
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'policy-isolation-'));
  await mkdir(path.join(root, 'schemas')); await copyFile('schemas/knowledge.schema.json', path.join(root, 'schemas/knowledge.schema.json'));
  await mkdir(path.join(root, 'knowledge')); await mkdir(path.join(root, 'source'));
  git('init'); await writeFile(path.join(root, 'source', 'policy.ts'), 'export const synthetic = 1;\n'); git('add', '.');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'Synthetic source'); revision = git('rev-parse', 'HEAD');
  paths = await resolvePaths({ root });
  paths.config.repositories = [{ id: 'alpha', name: 'Alpha', owner: 'local-owner', team: 'one', path: path.join(root, 'source'), aliases: [] }];
  paths.config.teams = ['one']; service = new KnowledgeService(paths);
});
afterEach(async () => { vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }); });

it('filters denied relationship and source references from summaries and full record headers', async () => {
  await record('beta.hidden', { scope: { kind: 'repo', repo_id: 'beta' }, title: 'Hidden title' });
  await record('alpha.visible', { relationships: [{ type: 'related-to', target: 'beta.hidden' }], sources: [{ kind: 'code', repo_id: 'beta', path: 'private/password.ts', commit: revision }, { kind: 'documentation', reference: 'knowledge:beta.hidden' }] });
  await index();
  for (const result of [await context(), await service.search('Synthetic', 'alpha'), await service.get('alpha.visible', 'alpha'), await service.related('alpha.visible', 'alpha')]) {
    expect(JSON.stringify(result)).not.toMatch(/beta|Hidden title|private\/password/);
  }
});
it('projects cross-repo scope metadata to authorized repository IDs', async () => {
  await record('alpha.cross', { scope: { kind: 'cross-repo', repo_ids: ['alpha', 'beta'] } }); await index();
  expect(JSON.stringify(await context())).not.toContain('beta');
  expect((await context()).results[0]?.scope).toEqual({ kind: 'cross-repo', repo_ids: ['alpha'] });
});
it('disputed and superseded records stay out of normal retrieval but can be explicitly inspected', async () => {
  await record('alpha.disputed', { status: 'disputed' }); await record('alpha.old', { status: 'superseded' }); await index();
  expect((await context()).results).toEqual([]);
  await expect(service.get('alpha.old', 'alpha')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  const historical = await (service.get as (...args: any[]) => Promise<any>)('alpha.old', 'alpha', 8192, true);
  expect(historical.record).toMatchObject({ editorial_status: 'superseded', normative: false });
});
it('stale mandatory policies block planning and are never silently removed', async () => {
  await record('alpha.policy', { type: 'approved-policy', sources: [approval, code()] });
  await writeFile(path.join(root, 'source', 'policy.ts'), 'export const synthetic = 2;\n'); git('add', '.');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'Synthetic changed source');
  await index(); const result = await context({ source_revision: git('rev-parse', 'HEAD') });
  expect(result.status).toBe('POLICY_REVIEW_REQUIRED');
  expect((result as any).policy_issues).toContainEqual({ id: 'alpha.policy', reason: 'needs_revalidation' });
  expect(result.results[0]).toMatchObject({ id: 'alpha.policy', normative: false });
});
it.each(['dirty_worktree', 'unknown', 'revision_not_checked'])('unverified mandatory policy evidence blocks with %s', async (reason) => {
  await record('alpha.policy', { type: 'approved-policy', sources: [approval, reason === 'unknown' ? { ...code(), commit: '0'.repeat(40) } : code()] });
  if (reason === 'dirty_worktree') await writeFile(path.join(root, 'source', 'policy.ts'), 'export const synthetic = 3;\n');
  await index(); const result = await context(reason === 'revision_not_checked' ? {} : { source_revision: revision });
  expect(result.status).toBe('POLICY_REVIEW_REQUIRED');
  expect((result as any).policy_issues).toContainEqual({ id: 'alpha.policy', reason });
});
it('missing explicit approval evidence and disputed policies cannot establish compliance', async () => {
  await record('alpha.policy', { type: 'approved-policy', sources: [code()] });
  await record('alpha.disputed', { type: 'approved-policy', status: 'disputed', sources: [approval] }); await index();
  const result = await context({ source_revision: revision });
  expect(result.status).toBe('POLICY_REVIEW_REQUIRED');
  expect((result as any).policy_issues).toEqual(expect.arrayContaining([{ id: 'alpha.policy', reason: 'approval_evidence_unavailable' }, { id: 'alpha.disputed', reason: 'disputed' }]));
});
it('approved contradictory policies are returned together as non-normative review context', async () => {
  await record('alpha.policy-a', { type: 'approved-policy', sources: [approval], relationships: [{ type: 'contradicts', target: 'alpha.policy-b' }] });
  await record('alpha.policy-b', { type: 'approved-policy', sources: [approval], summary: 'Different approved synthetic requirement.' }); await index();
  const result = await context();
  expect(result.status).toBe('POLICY_REVIEW_REQUIRED'); expect(result.results.map((item) => item.id).sort()).toEqual(['alpha.policy-a', 'alpha.policy-b']);
  expect(result.unresolved_conflicts.length).toBe(1); expect(result.results.every((item) => !(item as any).normative)).toBe(true);
});
it('persisted authorized reports are visible without publishing candidates or exposing their explanation', async () => {
  await record('alpha.a'); await record('alpha.b'); await index();
  const report = createConflictReport(paths, { repoId: 'alpha', recordIds: ['alpha.a', 'alpha.b'], explanation: 'private free text is not public conflict metadata' });
  const result = await context();
  expect(result.unresolved_conflicts).toContain(report.id);
  expect((result as any).conflicts).toContainEqual({ id: report.id, record_ids: ['alpha.a', 'alpha.b'], source: 'report' });
  expect(JSON.stringify(result)).not.toContain('private free text');
  expect((await readFile(path.join(root, 'knowledge', 'alpha.a.md'), 'utf8'))).toContain('status: verified');
});
it('mixed-access reports reveal no denied identities, report IDs, or conflict counts', async () => {
  await record('alpha.a'); await record('beta.hidden', { scope: { kind: 'repo', repo_id: 'beta' } }); await index();
  const report = createConflictReport(paths, { repoId: 'alpha', recordIds: ['alpha.a', 'beta.hidden'], explanation: 'hidden' });
  const result = await context();
  expect(result.unresolved_conflicts).toEqual([]); expect(JSON.stringify(result)).not.toMatch(new RegExp('beta|' + report.id));
});
it('malformed conflict state cannot be mislabeled as an empty conflict list', async () => {
  await record('alpha.a'); await index();
  const directory = path.join(root, 'candidates', 'alpha', 'conflicts'); await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'bad.json'), '{broken');
  await expect(context()).rejects.toMatchObject({ code: 'CONFLICT_STATE_UNAVAILABLE' });
});
it('mandatory policy overflow returns bounded follow-up references', async () => {
  await record('alpha.policy', { type: 'approved-policy', summary: 'Synthetic '.repeat(50), sources: [approval] }); await index();
  const result = await context({ max_tokens: 500 });
  expect(result.status).toBe('CONTEXT_BUDGET_EXCEEDED'); expect(result.omitted_mandatory_ids).toContain('alpha.policy');
  expect(result.estimated_tokens).toBeLessThanOrEqual(500);
  expect(Buffer.byteLength(JSON.stringify({ ok: true, data: result }))).toBeLessThanOrEqual(paths.config.budgets.maxBytes);
});
it('an SDK client gets policy-review status and explicit historical reads', async () => {
  await record('alpha.policy', { type: 'approved-policy', status: 'disputed', sources: [approval] }); await index();
  const server = createMcpServer(paths); const client = new Client({ name: 'policy-fixture', version: '1' });
  const [left, right] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(right); await client.connect(left);
    const result = await client.callTool({ name: 'get_task_context', arguments: { repo_id: 'alpha', task: 'Synthetic' } });
    expect(result.structuredContent).toMatchObject({ ok: true, data: { status: 'POLICY_REVIEW_REQUIRED' } });
    const history = await client.callTool({ name: 'get_knowledge', arguments: { id: 'alpha.policy', repo_id: 'alpha', include_history: true } });
    expect(history.structuredContent).toMatchObject({ ok: true, data: { record: { editorial_status: 'disputed', normative: false } } });
  } finally { await client.close(); await server.close(); }
});
it('only the configured repository owner can resolve a report and stale hashes are rejected', async () => {
  await record('alpha.a'); await record('alpha.b'); await index();
  const report = createConflictReport(paths, { repoId: 'alpha', recordIds: ['alpha.a', 'alpha.b'], explanation: 'Synthetic report for local review.' });
  const expectedHash = createHash('sha256').update(await readFile(report.path)).digest('hex');
  const request = { repoId: 'alpha', id: report.id, expectedHash, state: 'resolved', reason: 'Owner checked the fictional evidence.' };
  paths.config.principal = 'intruder';
  await expect((conflictStore as any).resolveConflictReport(paths, request)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  paths.config.principal = 'local-owner';
  expect(await (conflictStore as any).resolveConflictReport(paths, request)).toMatchObject({ state: 'resolved' });
  expect((await context()).unresolved_conflicts).toEqual([]);
  expect(JSON.parse(await readFile(report.path, 'utf8')).resolution.approver).toBe('local-owner');
  await expect((conflictStore as any).resolveConflictReport(paths, { ...request, state: 'rejected' })).rejects.toMatchObject({ code: 'CONFLICT' });
});
it('report creation uses canonical repository identity and rejects duplicate record IDs before writes', async () => {
  await record('alpha.a'); await record('alpha.b'); await index(); paths.config.repositories[0]!.aliases.push('old-alpha');
  const report = createConflictReport(paths, { repoId: 'old-alpha', recordIds: ['alpha.a', 'alpha.b'], explanation: 'Synthetic alias report.' });
  expect((await context()).unresolved_conflicts).toContain(report.id);
  expect(() => createConflictReport(paths, { repoId: 'alpha', recordIds: ['alpha.a', 'alpha.a'], explanation: 'Invalid duplicate.' })).toThrow();
});
it('review dates and unverifiable test evidence cannot be used to bypass policy review', async () => {
  await record('alpha.due', { type: 'approved-policy', sources: [approval], review_after: '2000-01-01T00:00:00Z' });
  await record('alpha.test-policy', { type: 'approved-policy', sources: [approval, { kind: 'test', repo_id: 'alpha', commit: revision, path: 'policy.ts', test_id: 'unverified-test' }] }); await index();
  expect((await service.get('alpha.due', 'alpha')).record.normative).toBe(false);
  expect((await context() as any).policy_issues).toContainEqual({ id: 'alpha.test-policy', reason: 'unknown' });
});
it('the facade retains blocking policy state and tiny impossible budgets return an explicit error', async () => {
  await record('alpha.policy', { type: 'approved-policy', status: 'disputed', sources: [approval] }); await index();
  expect((await new KnowledgeApplication(paths).retrieve({ contract_version: 1, repo_id: 'alpha', task: 'Synthetic' })).context.status).toBe('POLICY_REVIEW_REQUIRED');
  await expect(context({ max_tokens: 1 })).rejects.toMatchObject({ code: 'CONTEXT_BUDGET_EXCEEDED' });
});
it('more mandatory policies than the result limit cannot silently exceed the limit', async () => {
  await record('alpha.policy-a', { type: 'approved-policy', sources: [approval] });
  await record('alpha.policy-b', { type: 'approved-policy', sources: [approval] }); await index();
  const result = await context({ max_results: 1 });
  expect(result.status).toBe('CONTEXT_BUDGET_EXCEEDED'); expect(result.results.length).toBeLessThanOrEqual(1);
});
it('denied records are rejected before parsing corrupt private bodies', async () => {
  await record('beta.hidden', { scope: { kind: 'repo', repo_id: 'beta' } }); const built = await index();
  const db = new DatabaseSync(path.join(paths.runtimeRoot, 'index-generations', built.generation + '.sqlite'));
  db.prepare('UPDATE records SET body = ? WHERE id = ?').run('---\nprivate: [bad\n---\n', 'beta.hidden'); db.close();
  await expect(service.get('beta.hidden', 'alpha', 8192, true)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  expect((await context()).results).toEqual([]);
});
it('CLI historical inspection and owner conflict review are usable without a new MCP tool', async () => {
  await record('alpha.old', { status: 'superseded' }); await record('alpha.a'); await record('alpha.b'); await saveLocalConfig(paths, paths.config); await index();
  const report = createConflictReport(paths, { repoId: 'alpha', recordIds: ['alpha.a', 'alpha.b'], explanation: 'Synthetic CLI report.' });
  const command = (args: string[]) => JSON.parse(execFileSync(process.execPath, [path.resolve('dist/cli.js'), '--root', root, ...args], { encoding: 'utf8' }));
  expect(command(['get', '--id', 'alpha.old', '--repo', 'alpha', '--include-history']).record.normative).toBe(false);
  const inspected = command(['conflict', 'inspect', report.id, '--repo', 'alpha']);
  expect(command(['conflict', 'resolve', report.id, '--repo', 'alpha', '--expected-hash', inspected.hash, '--reason', 'Owner reviewed fictional sources.']).state).toBe('resolved');
});
it('SDK conflict receipts disclose no absolute checkout path', async () => {
  await record('alpha.a'); await record('alpha.b'); await index();
  const server = createMcpServer(paths); const client = new Client({ name: 'report-fixture', version: '1' }); const [left, right] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(right); await client.connect(left);
    const result = await client.callTool({ name: 'report_conflict', arguments: { repo_id: 'alpha', record_ids: ['alpha.a', 'alpha.b'], explanation: 'Synthetic SDK report.' } });
    expect(result.isError).not.toBe(true); expect(JSON.stringify(result)).not.toContain(root.replaceAll('\\', '\\\\'));
    expect((result.structuredContent as any).data).not.toHaveProperty('path');
  } finally { await client.close(); await server.close(); }
});
it('owner authorization is checked again after asynchronous evidence inspection', async () => {
  await record('alpha.a'); await record('alpha.b'); await index();
  const report = createConflictReport(paths, { repoId: 'alpha', recordIds: ['alpha.a', 'alpha.b'], explanation: 'Synthetic access-change case.' });
  const hash = createHash('sha256').update(await readFile(report.path)).digest('hex');
  const original = KnowledgeService.prototype.get;
  vi.spyOn(KnowledgeService.prototype, 'get').mockImplementation(async function (this: KnowledgeService, ...args) {
    const result = await original.apply(this, args); paths.config.principal = 'intruder'; return result;
  });
  await expect((conflictStore as any).resolveConflictReport(paths, { repoId: 'alpha', id: report.id, expectedHash: hash, state: 'rejected', reason: 'Synthetic review.' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  expect(JSON.parse(await readFile(report.path, 'utf8')).state).toBe('candidate');
});
