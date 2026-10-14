import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { stringify } from 'yaml';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { resolvePaths, type ResolvedPaths } from '../../src/core/config.js';
import { buildActiveGeneration } from '../../src/indexing/build-index.js';
import { KnowledgeService } from '../../src/retrieval/service.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../../src/mcp/server.js';
import { listRepositories } from '../../src/retrieval/repositories.js';
import { KnowledgeApplication } from '../../src/application/service.js';
let root: string, paths: ResolvedPaths, service: KnowledgeService;
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(),'ranked-progressive-'));
  await mkdir(path.join(root,'knowledge')); await mkdir(path.join(root,'schemas')); await copyFile('schemas/knowledge.schema.json',path.join(root,'schemas/knowledge.schema.json'));
  paths = await resolvePaths({root}); paths.config.repositories = [{id:'alpha',name:'Alpha',path:root,owner:'local-owner',team:'local',aliases:[]}];
  service = new KnowledgeService(paths);
});
afterEach(async () => { await rm(root,{recursive:true,force:true}); });
async function record(id: string, extra: object = {}, body = 'Fictional reference details.') {
  await writeFile(path.join(root,'knowledge',id+'.md'),'---\n'+stringify({schema_version:1,id,title:'Synthetic reference',summary:'Fictional reference summary.',type:'practice',scope:{kind:'repo',repo_id:'alpha'},status:'verified',owner:'local-owner',sources:[],relationships:[],created_at:'2020-01-01T00:00:00Z',updated_at:'2020-01-01T00:00:00Z',...extra})+'---\n'+body);
}
const index = () => buildActiveGeneration(root,paths.runtimeRoot);
const task = (options: object = {}) => service.taskContext({repo_id:'alpha',task:'cache expiry',...options});
const get = (options: object = {}) => (service.get as any)('alpha.a','alpha',8192,false,options);

it('AEF-009 matches operational alternatives without requiring every task word', async () => {
  await record('alpha.retry',{title:'Retry idempotency',summary:'Retry idempotency preserves request keys.'}); await index();
  expect((await task({task:'reattempt duplicate requests safely'})).results.map((item) => item.id)).toContain('alpha.retry');
});
it('AEF-009 treats topics and changed paths as separate positive signals', async () => {
  await record('alpha.cache',{title:'Cache expiry',summary:'Cache expiry removes entries.'}); await index();
  expect((await task({changed_paths:['src/cache.ts'],topics:['performance']})).results.map((item) => item.id)).toContain('alpha.cache');
});
it('AEF-009 ranks exact tags, paths and declared symbols with meaningful reasons', async () => {
  await record('alpha.generic',{title:'Cache expiry',summary:'Cache expiry removes entries.'});
  await record('alpha.specific',{tags:['retention'],sources:[{kind:'code',repo_id:'alpha',commit:'1'.repeat(40),path:'src/cache.ts',symbol:'expireCache'}]}); await index();
  const result = await task({task:'inspect implementation',topics:['retention','expireCache'],changed_paths:['src/cache.ts']});
  expect(result.results[0]?.id).toBe('alpha.specific');
  expect(result.results[0]?.matched_reasons).toEqual(expect.arrayContaining(['changed-path:exact','topic:tag','source:symbol']));
});
it('AEF-009 metadata matching never uses denied source or relationship fields', async () => {
  await record('alpha.a',{sources:[{kind:'code',repo_id:'vault',commit:'1'.repeat(40),path:'private/secrets.ts',symbol:'hiddenSymbol'}]}); await index();
  expect((await task({task:'hiddenSymbol',changed_paths:['private/secrets.ts']})).results).toEqual([]);
});
it('AEF-010 bounds complete search/get/related envelopes and fails when metadata cannot fit', async () => {
  await record('alpha.a',{relationships:[{type:'related-to',target:'alpha.b'}]}); await record('alpha.b'); await index(); paths.config.budgets.maxBytes = 20;
  for (const action of [() => service.search('Synthetic','alpha'),() => get(),() => service.related('alpha.a','alpha')]) await expect(action()).rejects.toMatchObject({code:'CONTEXT_BUDGET_EXCEEDED'});
});
it('AEF-010 expansion rejects generation drift instead of silently loading a newer snapshot', async () => {
  await record('alpha.a'); const first = await index(); await record('alpha.a',{summary:'Changed fictional summary.'}); await index();
  await expect(get({expected_generation:first.generation})).rejects.toMatchObject({code:'CONFLICT'});
});
it('AEF-010 body pages reconstruct UTF-8 data with generation-bound continuation', async () => {
  await record('alpha.a',{},'界🙂'.repeat(3000)); const built = await index(); paths.config.budgets.maxBytes = 3000;
  let cursor: string|undefined; let body = ''; let pages = 0;
  do {
    const result = await get({...cursor?{cursor}:{},expected_generation:built.generation,max_tokens:1000});
    expect(Buffer.byteLength(JSON.stringify({ok:true,data:result}))).toBeLessThanOrEqual(3000);
    expect(result.body).not.toContain('\ufffd'); body += result.body; cursor = result.next_cursor ?? undefined;
    expect(++pages).toBeLessThan(100);
  } while(cursor);
  expect(body).toContain('界🙂'.repeat(3000)); expect(pages).toBeGreaterThan(1);
});
it('AEF-010 search pagination is bounded and binds normalized requests and access', async () => {
  for (const suffix of ['a','b','c']) await record('alpha.'+suffix); await index();
  const first = await (service.search as any)('Synthetic','alpha',1,{});
  expect(first.next_cursor).toEqual(expect.any(String));
  const second = await (service.search as any)('Synthetic','alpha',1,{cursor:first.next_cursor}); expect(second.results[0].id).not.toBe(first.results[0].id);
  await expect((service.search as any)('different','alpha',1,{cursor:first.next_cursor})).rejects.toMatchObject({code:'VALIDATION_ERROR'});
});
it('AEF-010 missing/changed generation invalidates continuation', async () => {
  await record('alpha.a',{},'Fictional long body. '.repeat(2000)); await index(); paths.config.budgets.maxBytes = 3000;
  const first = await get(); expect(first.next_cursor).toEqual(expect.any(String)); await index();
  await expect(get({cursor:first.next_cursor})).rejects.toMatchObject({code:'VALIDATION_ERROR'});
});
it('AEF-010 MCP forwards generation and continuation controls', async () => {
  await record('alpha.a'); await index();
  const server=createMcpServer(paths), client=new Client({name:'progressive-test',version:'1'});
  const [a,b]=InMemoryTransport.createLinkedPair();
  try {
    await server.connect(a); await client.connect(b);
    const result=await client.callTool({name:'get_knowledge',arguments:{id:'alpha.a',repo_id:'alpha',expected_generation:'wrong-generation'}});
    expect(result.isError).toBe(true); expect(result.structuredContent).toMatchObject({ok:false,data:{error:{code:'CONFLICT'}}});
  } finally { await client.close(); await server.close(); }
});
it('AEF-010 related pages carry bounded relevant conflicts and unique edges', async () => {
  await record('alpha.a',{relationships:[{type:'related-to',target:'alpha.b'}]});
  await record('alpha.b',{relationships:[{type:'contradicts',target:'alpha.c'}]}); await record('alpha.c'); await index();
  const result=await service.related('alpha.a','alpha',[],2,12);
  expect((result as any).unresolved_conflicts).toHaveLength(1);
  expect(new Set(result.edges.map((edge)=>JSON.stringify(edge))).size).toBe(result.edges.length);
});
it('AEF-010 discovery honors the configured token cap including metadata', async () => {
  paths.config.budgets.maxTokens=1;
  await expect(listRepositories(paths)).rejects.toMatchObject({code:'CONTEXT_BUDGET_EXCEEDED'});
});
it('AEF-010 facade wrappers must also fit the caller token budget', async () => {
  await record('alpha.a',{title:'Cache expiry',summary:'Cache expiry removes entries.'}); await index();
  paths.config.budgets.maxTokens=8000; const raw=await task(); const budget=raw.estimated_tokens;
  try {
    const result=await new KnowledgeApplication(paths).retrieve({contract_version:1,repo_id:'alpha',task:'cache expiry',max_tokens:budget});
    expect(Math.ceil(Buffer.byteLength(JSON.stringify({ok:true,data:result}))/3)).toBeLessThanOrEqual(budget);
  } catch(error) { expect(error).toMatchObject({detail:{code:'CONTEXT_BUDGET_EXCEEDED'}}); }
});
it('AEF-010 related pagination preserves edges between nodes on different pages', async () => {
  await record('alpha.a',{relationships:[{type:'related-to',target:'alpha.b'}]});
  await record('alpha.b',{relationships:[{type:'related-to',target:'alpha.c'}]}); await record('alpha.c'); await index(); paths.config.budgets.maxDepth=2;
  let cursor: string|undefined; const edges: Array<{source:string;target:string}>=[]; let pages=0;
  do { const result=await service.related('alpha.a','alpha',[],2,1,{...(cursor?{cursor}:{})}); edges.push(...result.edges); cursor=result.next_cursor??undefined; expect(++pages).toBeLessThan(20); } while(cursor);
  expect(edges).toContainEqual({source:'alpha.b',target:'alpha.c',type:'related-to'});
});
it.each([NaN,-1,1.5])('AEF-010 validates direct result limits: %s', async (limit) => {
  await record('alpha.a'); await index();
  await expect(service.search('Synthetic','alpha',limit)).rejects.toMatchObject({code:'VALIDATION_ERROR'});
});
it('AEF-010 context and body controls reject nonfinite values before querying', async () => {
  await record('alpha.a'); await index();
  await expect(task({max_results:NaN})).rejects.toMatchObject({code:'VALIDATION_ERROR'});
});
it('AEF-010 returns a complete body when it fits but cursor overhead would not', async () => {
  await record('alpha.a',{},'A short fictional body.'); await index();
  const full=await service.get('alpha.a','alpha');
  paths.config.budgets.maxBytes=Buffer.byteLength(JSON.stringify({ok:true,data:full}));
  const result=await service.get('alpha.a','alpha');
  expect(result.body).toBe(full.body); expect(result.next_cursor).toBeNull();
});
it('AEF-009 ranks narrative consistently for CRLF records with long metadata', async () => {
  await record('alpha.a',{tags:Array.from({length:500},(_,i)=>'tag'+i)},'cache expiry');
  const file=path.join(root,'knowledge','alpha.a.md');
  await writeFile(file,(await readFile(file,'utf8')).replaceAll('\n','\r\n')); await index();
  expect((await task()).results.map((item)=>item.id)).toContain('alpha.a');
});
it('AEF-010 rejects oversized evidence metadata rather than returning over-budget reads', async () => {
  await record('alpha.a',{sources:Array.from({length:100},(_,i)=>({kind:'documentation',reference:'https://fictional.invalid/evidence/'+i+'x'.repeat(1000)}))}); await index();
  paths.config.budgets.maxBytes=1500;
  await expect(service.get('alpha.a','alpha')).rejects.toMatchObject({code:'CONTEXT_BUDGET_EXCEEDED'});
  await expect(service.search('Synthetic','alpha')).rejects.toMatchObject({code:'CONTEXT_BUDGET_EXCEEDED'});
});
