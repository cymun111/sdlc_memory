import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { KnowledgeApplication } from '../../src/application/service.js';
import { resolvePaths, type ResolvedPaths } from '../../src/core/config.js';
import { createHash } from 'node:crypto';
import { buildActiveGeneration } from '../../src/indexing/build-index.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import * as provenanceStore from '../../src/indexing/provenance.js';
import { symlink } from 'node:fs/promises';
const receiptFile = () => path.join(paths.runtimeRoot,'onboarding',createHash('sha256').update('sample-app').digest('hex')+'.json');
let root: string, source: string, paths: ResolvedPaths, application: KnowledgeApplication;
function git(...args: string[]) { return execFileSync('git', ['-C', source, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
function commit() { git('add', '.'); git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'Synthetic onboarding'); }
const request = (extra = {}) => ({ contract_version: 1, mode: 'apply', transport: 'stdio', repository: { id: 'sample-app', path: source, owner: 'local-owner', team: 'local' }, ...extra });
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'onboarding space ')); source = path.join(root, 'source app');
  const knowledge = path.join(root, 'knowledge checkout'); await mkdir(source); await mkdir(path.join(knowledge, 'schemas'), { recursive: true }); await mkdir(path.join(knowledge, 'knowledge'));
  await copyFile('schemas/knowledge.schema.json', path.join(knowledge, 'schemas/knowledge.schema.json'));
  git('init'); await writeFile(path.join(source, 'main.ts'), 'export const fictional = 1;'); commit();
  paths = await resolvePaths({ root: knowledge }); application = new KnowledgeApplication(paths);
});
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); });
it('applies setup on spaced paths, verifies real stdio service, and never claims context consumption', async () => {
  const result = await application.setup(request());
  expect(result).toMatchObject({ state: 'service-verified', context_delivery_verified: false, repo_id: 'sample-app' });
  expect((result as any).steps.map((step: any) => [step.name, step.state])).toEqual([['registration','complete'],['map','complete'],['index','complete'],['client_configuration','complete'],['tool_discovery','complete'],['scoped_read','complete']]);
  expect(git('status', '--porcelain')).toBe('');
  expect((result as any).description_status).toBe('unavailable');
});
it('reruns reuse the durable receipt and unchanged completed steps', async () => {
  const first = await application.setup(request({ verify_service: false }));
  const second = await new KnowledgeApplication(await resolvePaths({ root: paths.knowledgeRoot })).setup(request({ verify_service: false }));
  expect(second).toMatchObject({ state: 'configured', receipt_id: (first as any).receipt_id, steps: (first as any).steps });
});
it('changed HEAD rebuilds the map without repeating registration or unchanged index work', async () => {
  const first = await application.setup(request({ verify_service: false }));
  await writeFile(path.join(source, 'main.ts'), 'export const fictional = 2;'); commit();
  const second = await application.setup(request({ verify_service: false }));
  const attempts = (result: any, name: string) => result.steps.find((step: any) => step.name === name).attempts;
  expect(attempts(second,'map')).toBe(attempts(first,'map') + 1);
  expect(attempts(second,'registration')).toBe(attempts(first,'registration'));
  expect(attempts(second,'index')).toBe(attempts(first,'index'));
});
it('rejects non-Git/wrong roots and ID/path conflicts before configuration changes', async () => {
  await expect(application.setup(request({ repository: { id: 'sample-app', path: root, owner: 'local-owner', team: 'local' } }))).rejects.toMatchObject({ detail: { code: 'VALIDATION_ERROR' } });
  await expect(readFile(paths.configPath)).rejects.toMatchObject({ code: 'ENOENT' });
  await application.setup(request({ verify_service: false })); const original = await readFile(paths.configPath, 'utf8');
  await expect(application.setup(request({ repository: { id: 'sample-app', path: root, owner: 'local-owner', team: 'local' } }))).rejects.toBeDefined();
  expect(await readFile(paths.configPath,'utf8')).toBe(original);
});
it('persists partial failure and retries failed index work while preserving registration', async () => {
  await writeFile(path.join(paths.knowledgeRoot, 'knowledge/broken.md'), 'not valid knowledge');
  const failed = await application.setup(request({ verify_service: false }));
  expect(failed).toMatchObject({ state: 'failed', steps: expect.arrayContaining([expect.objectContaining({ name: 'index', state: 'failed', retryable: true })]) });
  expect(paths.config.repositories[0]?.id).toBe('sample-app');
  await rm(path.join(paths.knowledgeRoot, 'knowledge/broken.md'));
  const fixed = await application.setup(request({ verify_service: false }));
  expect(fixed).toMatchObject({ state: 'configured', receipt_id: (failed as any).receipt_id });
});
it('reports dirty source as degraded without changing the checkout', async () => {
  await writeFile(path.join(source, 'main.ts'), 'export const fictional = 3;');
  expect(await application.setup(request({ verify_service: false }))).toMatchObject({ state: 'degraded', source_dirty: true, context_delivery_verified: false });
  expect(await readFile(path.join(source,'main.ts'),'utf8')).toContain('3');
});
it('does not claim verification for unsupported native clients or edit their configuration', async () => {
  expect(await application.setup(request({ verify_service: false, client: 'cursor' }))).toMatchObject({ state: 'degraded', client_preview: { native_client_verified: false, external_edits_authorized: false } });
});
it('uninstall removes owned registration/artifacts while preserving unrelated settings', async () => {
  await application.setup(request({ verify_service: false }));
  const uninstall = (application as any).uninstall;
  expect(typeof uninstall).toBe('function');
  const result = await uninstall.call(application, { contract_version: 1, repo_id: 'sample-app' });
  expect(result.state).toBe('uninstalled');
  expect(paths.config.repositories).toEqual([]);
  expect(paths.config.budgets.maxTokens).toBe(2000);
  expect(git('status','--porcelain')).toBe('');
});
it('uninstall reloads changed unrelated durable settings instead of overwriting them', async () => {
  await application.setup(request({verify_service:false}));
  const config = JSON.parse(await readFile(paths.configPath,'utf8')); config.budgets.maxTokens = 3333;
  await writeFile(paths.configPath,JSON.stringify(config));
  await (application as any).uninstall({contract_version:1,repo_id:'sample-app'});
  expect(JSON.parse(await readFile(paths.configPath,'utf8')).budgets.maxTokens).toBe(3333);
});
it('externally changed registration is not silently adopted as owned on rerun', async () => {
  await application.setup(request({verify_service:false}));
  const config = JSON.parse(await readFile(paths.configPath,'utf8')); config.repositories[0].name = 'Externally managed';
  await writeFile(paths.configPath,JSON.stringify(config));
  await expect(application.setup(request({verify_service:false}))).rejects.toMatchObject({detail:{code:'CONFLICT'}});
});
it('a newer active generation invalidates service-verification steps and updates provenance', async () => {
  const first = await application.setup(request());
  const built = await buildActiveGeneration(paths.knowledgeRoot,paths.runtimeRoot);
  const second = await application.setup(request());
  expect(second.index_generation).toBe(built.generation);
  expect((second as any).steps.find((step:any) => step.name === 'scoped_read').attempts).toBe((first as any).steps.find((step:any) => step.name === 'scoped_read').attempts+1);
});
it('malformed receipts return safe conflict errors without echoing their text', async () => {
  await application.setup(request({verify_service:false})); await writeFile(receiptFile(),'private credential corrupted receipt');
  await expect(application.setup(request({verify_service:false}))).rejects.toMatchObject({detail:{code:'CONFLICT'}});
});
it('externally changed launch previews are preserved when settings change', async () => {
  await application.setup(request({verify_service:false})); const launch = receiptFile().replace('.json','.launch.json');
  await writeFile(launch,'external client settings');
  await expect(application.setup(request({verify_service:false,client:'cursor'}))).rejects.toMatchObject({detail:{code:'CONFLICT'}});
  expect(await readFile(launch,'utf8')).toBe('external client settings');
});
it('failed MCP verification persists sanitized diagnostics and retries without recreating registration', async () => {
  vi.spyOn(Client.prototype,'listTools').mockRejectedValueOnce(new Error('private credential '+root));
  const failed = await application.setup(request());
  expect(failed.state).toBe('failed');
  expect(JSON.stringify(failed.steps)).not.toMatch(/private credential|onboarding space/);
  const recovered = await application.setup(request());
  expect(recovered.state).toBe('service-verified');
  expect(recovered.steps?.find((step) => step.name === 'registration')?.attempts).toBe(1);
});
it('changed owned owner/team settings invalidate only registration and service prerequisites', async () => {
  const first = await application.setup(request({verify_service:false}));
  const updated = await application.setup(request({verify_service:false,repository:{id:'sample-app',path:source,owner:'new-owner',team:'new-team'}}));
  expect(paths.config.repositories[0]).toMatchObject({owner:'new-owner',team:'new-team'});
  expect(updated.steps?.find((step) => step.name === 'map')?.attempts).toBe(first.steps?.find((step) => step.name === 'map')?.attempts);
});
it('plan validates a Git root without creating runtime settings or receipts', async () => {
  expect(await application.setup(request({mode:'plan'}))).toMatchObject({state:'planned',context_delivery_verified:false});
  await expect(readFile(paths.configPath)).rejects.toMatchObject({code:'ENOENT'});
  await expect(readFile(receiptFile())).rejects.toMatchObject({code:'ENOENT'});
});
it('setup leaves a retained lock intact and reports a conflict', async () => {
  await mkdir(path.join(paths.runtimeRoot,'onboarding'),{recursive:true});
  const lock = path.join(paths.runtimeRoot,'onboarding/setup.lock'); await writeFile(lock,'retained lock');
  await expect(application.setup(request({verify_service:false}))).rejects.toMatchObject({detail:{code:'CONFLICT'}});
  expect(await readFile(lock,'utf8')).toBe('retained lock');
});
it('uninstall preserves pre-existing registration and maps', async () => {
  const { registerRepository } = await import('../../src/core/config.js');
  const { buildRepositoryMap } = await import('../../src/retrieval/repository-map.js');
  await registerRepository(paths,{id:'sample-app',repoPath:source,owner:'local-owner',team:'local'}); await buildRepositoryMap(paths,'sample-app');
  await application.setup(request({verify_service:false}));
  await application.uninstall({contract_version:1,repo_id:'sample-app'});
  expect(paths.config.repositories[0]?.id).toBe('sample-app');
});
it('readiness exposes the durable setup receipt without claiming delivery', async () => {
  const setup = await application.setup(request({verify_service:false}));
  expect(await application.readiness({contract_version:1,repo_id:'sample-app'})).toMatchObject({onboarding:{receipt_id:setup.receipt_id,state:'configured',context_delivery_verified:false}});
});
it('onboards maps larger than the receipt-size limit', async () => {
  await Promise.all(Array.from({length:500},(_,index) => writeFile(path.join(source,`synthetic-${index}.ts`),'export {};'))); commit();
  const result = await application.setup(request({verify_service:false}));
  expect(result.state).toBe('configured');
});
it('CLI setup apply uses the same facade and emits a durable configured receipt', async () => {
  const entry = path.resolve('dist/cli.js');
  const output = execFileSync(process.execPath,[entry,'--root',paths.knowledgeRoot,'setup','apply','--id','sample-app','--path',source,'--owner','local-owner','--team','local','--skip-service-verification'],{encoding:'utf8'});
  expect(JSON.parse(output)).toMatchObject({state:'configured',context_delivery_verified:false});
});
it('durable config reload is pinned even when KNOWLEDGE_CONFIG points elsewhere', async () => {
  await application.setup(request({verify_service:false}));
  const durable = JSON.parse(await readFile(paths.configPath,'utf8')); durable.budgets.maxTokens = 3333;
  await writeFile(paths.configPath,JSON.stringify(durable));
  const external = path.join(root,'external-config.json'); const other = structuredClone(durable); other.budgets.maxTokens = 777;
  await writeFile(external,JSON.stringify(other)); vi.stubEnv('KNOWLEDGE_CONFIG',external);
  await application.uninstall({contract_version:1,repo_id:'sample-app'});
  expect(JSON.parse(await readFile(paths.configPath,'utf8')).budgets.maxTokens).toBe(3333);
  expect(JSON.parse(await readFile(external,'utf8')).budgets.maxTokens).toBe(777);
});
it('unavailable knowledge inputs persist retry guidance without private diagnostics', async () => {
  vi.spyOn(provenanceStore,'captureBuildInputs').mockRejectedValueOnce(new Error('private credential '+root));
  const result = await application.setup(request({verify_service:false}));
  expect(result.steps?.find((step) => step.name === 'index')).toMatchObject({state:'failed',retryable:true,diagnostic:expect.any(String)});
  expect(JSON.stringify(result.steps)).not.toMatch(/private credential|onboarding space/);
});
it('linked onboarding storage is rejected before writing to source', async () => {
  await mkdir(paths.runtimeRoot,{recursive:true}); await symlink(source,path.join(paths.runtimeRoot,'onboarding'),process.platform === 'win32' ? 'junction':'dir');
  await expect(application.setup(request({verify_service:false}))).rejects.toMatchObject({detail:{code:'FORBIDDEN'}});
  expect(git('status','--porcelain')).toBe('');
});
it('readiness reports source drift as degraded without mutating the receipt', async () => {
  await application.setup(request({verify_service:false})); const receipt = await readFile(receiptFile(),'utf8');
  await writeFile(path.join(source,'main.ts'),'export const fictional = 4;');
  expect(await application.readiness({contract_version:1,repo_id:'sample-app'})).toMatchObject({onboarding:{state:'degraded'}});
  expect(await readFile(receiptFile(),'utf8')).toBe(receipt);
});
