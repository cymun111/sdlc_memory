import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { ResolvedPaths } from '../core/config.js';
import { saveLocalConfig, resolvePaths } from '../core/config.js';
import { buildRepositoryMap, getRepositoryMap } from '../retrieval/repository-map.js';
import { listRepositories } from '../retrieval/repositories.js';
import { captureBuildInputs, optionalProvenance } from '../indexing/provenance.js';
import { buildActiveGeneration } from '../indexing/build-index.js';
import { setupRequest, setupOutput, uninstallRequest, parseRequest, IntegrationContractError } from '../application/contracts.js';
import { onboardingReceipt, stepNames, type OnboardingReceipt } from './contracts.js';
import type { z } from 'zod';
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value, (_key, item: unknown) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a],[b]) => a.localeCompare(b))) : item)).digest('hex');
const bytesHash = (value: string) => createHash('sha256').update(value).digest('hex');
const now = () => new Date().toISOString();
const fail = (code: 'VALIDATION_ERROR'|'CONFLICT'|'FORBIDDEN'|'NOT_FOUND', message: string): never => { throw new IntegrationContractError(code, message); };
const entry = fileURLToPath(new URL('../../dist/cli.js', import.meta.url));
function files(paths: ResolvedPaths, id: string) {
  const key = bytesHash(id); const directory = path.join(paths.runtimeRoot,'onboarding');
  return { directory, receipt: path.join(directory,key+'.json'), launch: path.join(directory,key+'.launch.json'), map: path.join(paths.runtimeRoot,'repository-maps',key+'.json'), lock: path.join(directory,'setup.lock') };
}
async function safeDirectory(directory: string, create = false) {
  let ancestor = directory;
  while (true) {
    try { if (!(await lstat(ancestor)).isDirectory() || await realpath(ancestor) !== ancestor) fail('FORBIDDEN','Onboarding storage must not resolve through a link.'); break; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; const parent = path.dirname(ancestor); if (parent === ancestor) fail('FORBIDDEN','Onboarding storage is unavailable.'); ancestor = parent; }
  }
  if (create) { await mkdir(directory,{recursive:true}); if (await realpath(directory) !== directory) fail('FORBIDDEN','Onboarding storage must not resolve through a link.'); }
}
async function readRegular(filename: string): Promise<string|null> {
  try { const status = await lstat(filename); if (!status.isFile() || status.isSymbolicLink() || status.size > 128*1024) fail('FORBIDDEN','Onboarding artifact is unsafe.'); return await readFile(filename,'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}
async function save(filename: string, value: unknown) {
  const temporary = filename+'.'+randomUUID()+'.tmp';
  try { await writeFile(temporary,JSON.stringify(value)+'\n',{flag:'wx',mode:0o600,flush:true}); await rename(temporary,filename); }
  finally { await rm(temporary,{force:true}); }
}
async function receiptAt(filename: string) {
  const body = await readRegular(filename); if (!body) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { return fail('CONFLICT','Onboarding receipt is invalid; preserve it for operator review.'); }
  const result = onboardingReceipt.safeParse(parsed);
  if (!result.success) fail('CONFLICT','Onboarding receipt is invalid; preserve it for operator review.');
  return result.data;
}
function publicResult(receipt: OnboardingReceipt) {
  return setupOutput.parse({contract_version:1,state:receipt.state,repo_id:receipt.repo_id,transport:'stdio',writes:[],external_edits_authorized:false,receipt_id:receipt.receipt_id,steps:receipt.steps,context_delivery_verified:false,source_dirty:receipt.source_dirty,description_status:receipt.description_status,client_preview:receipt.client_preview,source_revision:receipt.source_revision,index_generation:receipt.index_generation});
}
function git(source: string, ...args: string[]) {
  try { return execFileSync('git',['-C',source,...args],{encoding:'utf8',timeout:10000,windowsHide:true,stdio:['ignore','pipe','pipe']}).trim(); }
  catch { return fail('VALIDATION_ERROR','Repository must be an accessible Git root with a committed HEAD.'); }
}
async function validate(paths: ResolvedPaths, input: z.infer<typeof setupRequest>) {
  if (!path.isAbsolute(input.repository.path)) fail('VALIDATION_ERROR','Repository path must be absolute.');
  let canonical: string;
  try { canonical = await realpath(input.repository.path); if (await realpath(paths.knowledgeRoot) !== paths.knowledgeRoot) throw new Error(); await lstat(path.join(paths.knowledgeRoot,'schemas/knowledge.schema.json')); }
  catch { return fail('VALIDATION_ERROR','Source and knowledge roots must exist with a knowledge schema.'); }
  if (await realpath(git(canonical,'rev-parse','--show-toplevel')) !== canonical) fail('VALIDATION_ERROR','Select the Git repository root, not a nested directory.');
  const contains = (a: string,b: string) => a === b || b.startsWith(a+path.sep);
  if (contains(canonical,paths.knowledgeRoot) || contains(paths.knowledgeRoot,canonical)) fail('VALIDATION_ERROR','Source and knowledge roots must be separate.');
  if (paths.runtimeRoot !== path.join(paths.knowledgeRoot,'.runtime') || paths.configPath !== path.join(paths.runtimeRoot,'config.json')) fail('VALIDATION_ERROR','Onboarding requires the knowledge-owned local runtime configuration.');
  await safeDirectory(paths.runtimeRoot); await safeDirectory(files(paths,input.repository.id).directory); await safeDirectory(path.join(paths.runtimeRoot,'repository-maps'));
  const revision = git(canonical,'rev-parse','HEAD^{commit}');
  return {canonical,revision,dirty: Boolean(git(canonical,'status','--porcelain'))};
}
async function probe(paths: ResolvedPaths, repo: string, revision: string, discovery: boolean) {
  const client = new Client({name:'sdlc-memory-onboarding',version:'1.0.0'});
  const transport = new StdioClientTransport({command:process.execPath,args:[entry,'--root',paths.knowledgeRoot,'--config',paths.configPath,'serve','--transport','stdio'],cwd:paths.knowledgeRoot,stderr:'pipe'});
  try {
    await client.connect(transport,{timeout:10000});
    if (discovery) {
      const tools = await client.listTools({}, {timeout:10000});
      const names = new Set(tools.tools.map((tool) => tool.name));
      if (!['list_repositories','get_repository_map','get_task_context','search_knowledge','get_knowledge','get_related','submit_learning','report_conflict','update_candidate'].every((name) => names.has(name))) throw new Error('Missing tools');
    } else {
      const result = await client.callTool({name:'get_task_context',arguments:{repo_id:repo,task:'onboarding readiness',source_revision:revision}},undefined,{timeout:10000});
      const envelope = result.structuredContent as {ok?:boolean;data?:{application_source?:{repo_id?:string};status?:string}}|undefined;
      if (result.isError || !envelope?.ok || envelope.data?.application_source?.repo_id !== repo || envelope.data.status !== 'ok') throw new Error('Scoped context is blocked');
    }
  } finally { await client.close(); await transport.close(); }
}
export async function setupRepository(paths: ResolvedPaths, request: unknown) {
  const input = parseRequest(setupRequest,request); const validated = await validate(paths,input); const artifact = files(paths,input.repository.id);
  // Reload durable settings for independent invocations; the explicit roots/principal remain trusted.
  if (await readRegular(paths.configPath)) paths.config = (await resolvePaths({root:paths.knowledgeRoot})).config;
  const previous = await receiptAt(artifact.receipt);
  if (previous && (previous.repo_id !== input.repository.id || previous.principal !== paths.config.principal)) fail('CONFLICT','Onboarding receipt belongs to a different identity.');
  const matches = paths.config.repositories.filter((repo) => repo.id === input.repository.id || repo.aliases.includes(input.repository.id));
  const existing = matches[0];
  if (matches.length > 1 || (existing && (existing.id !== input.repository.id || existing.path !== validated.canonical))) fail('CONFLICT','Repository identity/path conflicts with registration.');
  if (paths.config.repositories.some((repo) => repo.id !== input.repository.id && repo.path === validated.canonical)) fail('CONFLICT','Source checkout is already registered under another ID.');
  if (previous?.owned_registration && previous.state !== 'uninstalled' && existing && hash(existing) !== hash(previous.registration_snapshot)) {
    const pending = previous.steps.find((value) => value.name === 'registration');
    if (pending?.state !== 'pending' || pending.fingerprint !== hash(existing)) fail('CONFLICT','Registration changed externally; preserve settings for review.');
  }
  if (previous?.launch_hash) {
    const launch = await readRegular(artifact.launch);
    if (launch && bytesHash(launch) !== previous.launch_hash) fail('CONFLICT','Launch artifact changed externally; preserve it for review.');
  }
  if (existing && (existing.owner !== input.repository.owner || existing.team !== input.repository.team) && (!previous?.owned_registration || hash(existing) !== hash(previous.registration_snapshot))) fail('CONFLICT','Existing registration settings are not owned by this setup.');
  const registration = {id:input.repository.id,name:existing?.name??input.repository.id,path:validated.canonical,owner:input.repository.owner,team:input.repository.team,aliases:existing?.aliases??[]};
  const preview = {command:process.execPath,args:[entry,'--root',paths.knowledgeRoot,'--config',paths.configPath,'serve','--transport','stdio'],native_client_verified:false as const,external_edits_authorized:false as const};
  if (input.mode === 'plan') return setupOutput.parse({contract_version:1,state:'planned',repo_id:registration.id,transport:'stdio',writes:['local-registration','repository-map','index','client-configuration'],external_edits_authorized:false,context_delivery_verified:false,source_dirty:validated.dirty,client_preview:preview});
  await safeDirectory(artifact.directory,true);
  try { await writeFile(artifact.lock,'onboarding\n',{flag:'wx',mode:0o600}); }
  catch { return fail('CONFLICT','Another onboarding operation or retained lock requires review.'); }
  try {
    if (hash(await receiptAt(artifact.receipt)) !== hash(previous) || (await readRegular(paths.configPath) && hash((await resolvePaths({root:paths.knowledgeRoot})).config) !== hash(paths.config))) fail('CONFLICT','Setup inputs changed while acquiring the lock; retry.');
    const receipt: OnboardingReceipt = previous && previous.state !== 'uninstalled' ? previous : {
      schema_version:1,receipt_id:randomUUID(),repo_id:registration.id,principal:paths.config.principal,fingerprint:'',state:'configured',created_at:now(),updated_at:now(),source_revision:null,index_generation:null,
      registration_before:existing??null,registration_snapshot:registration,owned_registration:!existing,owned_map:!(await readRegular(artifact.map)),map_hash:null,launch_hash:null,
      steps:stepNames.map((name) => ({name,state:'pending',fingerprint:'',attempts:0,verified_at:null,retryable:false,diagnostic:null})),source_dirty:validated.dirty,context_delivery_verified:false,description_status:'unavailable',client_preview:preview
    };
    if (!previous && await readRegular(artifact.launch)) fail('CONFLICT','Launch artifact is not owned by this setup.');
    receipt.fingerprint = hash({input,canonical:validated.canonical,knowledge:paths.knowledgeRoot,principal:paths.config.principal}); receipt.source_dirty = validated.dirty; receipt.client_preview = preview; receipt.state = 'configured';
    const persist = async () => { receipt.updated_at = now(); await save(artifact.receipt,onboardingReceipt.parse(receipt)); };
    await persist();
    const step = async (name: typeof stepNames[number], fingerprint: string, action: () => Promise<void>, degraded = false) => {
      const state = receipt.steps.find((value) => value.name === name)!;
      if (state.state === 'complete' && state.fingerprint === fingerprint) return true;
      state.fingerprint = fingerprint; state.state = 'pending'; state.attempts++; state.diagnostic = null; state.retryable = false; await persist();
      try { await action(); state.state = degraded ? 'degraded':'complete'; state.verified_at = now(); state.retryable = degraded; state.diagnostic = degraded ? 'Native client adapter is unavailable; use the manual launch preview.':null; }
      catch { state.state = 'failed'; state.retryable = true; state.diagnostic = 'Setup step failed; repair its inputs or local service and rerun identical setup.'; receipt.state = 'failed'; await persist(); return false; }
      await persist(); return true;
    };
    if (!await step('registration',hash(registration),async () => {
      receipt.registration_snapshot = registration;
      const config = {...paths.config,repositories:paths.config.repositories.filter((repo) => repo.id !== registration.id).concat(registration),teams:[...new Set([...paths.config.teams,registration.team])]};
      await saveLocalConfig(paths,config); paths.config = config;
    })) return publicResult(receipt);
    const map = await getRepositoryMap(paths,{repo_id:registration.id}).catch(() => null);
    const mapKey = hash([registration.id,validated.canonical,validated.revision]);
    if (!map || map.source_revision !== validated.revision) receipt.steps.find((value) => value.name === 'map')!.state = 'pending';
    if (!await step('map',mapKey,async () => { await buildRepositoryMap(paths,registration.id,validated.revision); receipt.map_hash = bytesHash((await readRegular(artifact.map))!); receipt.source_revision = validated.revision; })) return publicResult(receipt);
    let inputs;
    try { inputs = await captureBuildInputs(paths.knowledgeRoot); }
    catch { receipt.steps.find((value) => value.name === 'index')!.state = 'failed'; receipt.state = 'failed'; await persist(); return publicResult(receipt); }
    const indexKey = hash([inputs.contentFingerprint,inputs.schemaFingerprint,inputs.git]);
    const metadata = await optionalProvenance(paths.knowledgeRoot,paths.runtimeRoot).catch(() => null);
    if (!metadata?.index_generation) receipt.steps.find((value) => value.name === 'index')!.state = 'pending';
    if (!await step('index',indexKey,async () => { const built = await buildActiveGeneration(paths.knowledgeRoot,paths.runtimeRoot); receipt.index_generation = built.generation; })) return publicResult(receipt);
    const activeMetadata = await optionalProvenance(paths.knowledgeRoot,paths.runtimeRoot);
    receipt.index_generation = activeMetadata.index_generation;
    if (!await readRegular(artifact.launch)) receipt.steps.find((value) => value.name === 'client_configuration')!.state = 'pending';
    if (!await step('client_configuration',hash([preview,input.client]),async () => { await save(artifact.launch,preview); receipt.launch_hash = bytesHash((await readRegular(artifact.launch))!); },input.client !== 'manual')) return publicResult(receipt);
    const verificationKey = hash([receipt.index_generation,mapKey,hash(paths.config),input.client,hash(preview)]);
    if (input.verify_service) {
      if (!await step('tool_discovery',verificationKey,() => probe(paths,registration.id,validated.revision,true))) return publicResult(receipt);
      if (!await step('scoped_read',verificationKey,() => probe(paths,registration.id,validated.revision,false))) return publicResult(receipt);
      receipt.state = 'service-verified';
    } else {
      for (const name of ['tool_discovery','scoped_read']) { const state = receipt.steps.find((value) => value.name === name)!; state.state = 'pending'; state.fingerprint = ''; state.verified_at = null; }
    }
    const discovery = await listRepositories(paths,{query:registration.id}); receipt.description_status = discovery.repositories.find((repo) => repo.id === registration.id)?.description_status ?? 'unavailable';
    if (validated.dirty || receipt.steps.some((state) => state.state === 'degraded')) receipt.state = 'degraded';
    await persist(); return publicResult(receipt);
  } finally { await rm(artifact.lock,{force:true}); }
}
export async function uninstallRepository(paths: ResolvedPaths, request: unknown) {
  const input = parseRequest(uninstallRequest,request); const artifact = files(paths,input.repo_id); await safeDirectory(artifact.directory);
  const receipt = await receiptAt(artifact.receipt); if (!receipt || receipt.repo_id !== input.repo_id) return fail('NOT_FOUND','No owned onboarding receipt exists.');
  if (receipt.principal !== paths.config.principal) fail('FORBIDDEN','Onboarding receipt belongs to another principal.');
  await safeDirectory(artifact.directory,true);
  try { await writeFile(artifact.lock,'uninstall\n',{flag:'wx',mode:0o600}); } catch { return fail('CONFLICT','Onboarding lock requires review.'); }
  try {
    if (await readRegular(paths.configPath)) paths.config = (await resolvePaths({root:paths.knowledgeRoot})).config;
    if (receipt.principal !== paths.config.principal) fail('FORBIDDEN','Onboarding principal changed; preserve settings for review.');
    const current = paths.config.repositories.find((repo) => repo.id === receipt.repo_id);
    if (receipt.owned_registration && current && hash(current) !== hash(receipt.registration_snapshot)) fail('CONFLICT','Registration changed externally; preserve settings for review.');
    for (const [filename,expected,owned] of [[artifact.launch,receipt.launch_hash,true],[artifact.map,receipt.map_hash,receipt.owned_map]] as const) {
      if (!owned || !expected) continue; const body = await readRegular(filename); if (body && bytesHash(body) !== expected) fail('CONFLICT','Owned artifact changed externally; preserve it for review.');
    }
    if (receipt.owned_registration) { const config = {...paths.config,repositories:paths.config.repositories.filter((repo) => repo.id !== receipt.repo_id)}; await saveLocalConfig(paths,config); paths.config = config; }
    if (receipt.launch_hash) await rm(artifact.launch,{force:true}); if (receipt.owned_map && receipt.map_hash) await rm(artifact.map,{force:true});
    receipt.state = 'uninstalled'; receipt.updated_at = now(); await save(artifact.receipt,receipt); return publicResult(receipt);
  } finally { await rm(artifact.lock,{force:true}); }
}
