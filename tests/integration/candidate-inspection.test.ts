import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import os from 'node:os';
import { stringify } from 'yaml';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as inspection from '../../src/capture/inspection.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../../src/mcp/server.js';
import { resolvePaths, type ResolvedPaths } from '../../src/core/config.js';
import { buildActiveGeneration } from '../../src/indexing/build-index.js';

let root:string,paths:ResolvedPaths,client:Client,server:ReturnType<typeof createMcpServer>;
beforeEach(async()=>{
  root=await mkdtemp(path.join(os.tmpdir(),'candidate-inspection-'));
  await mkdir(path.join(root,'schemas'));await copyFile('schemas/knowledge.schema.json',path.join(root,'schemas/knowledge.schema.json'));await mkdir(path.join(root,'knowledge'));
  paths=await resolvePaths({root});paths.config.repositories=[{id:'alpha',name:'Alpha',path:root,owner:'local-owner',team:'local',aliases:['alias-alpha']},{id:'vault',name:'Private sentinel',path:root,owner:'other-owner',team:'private',aliases:[]}];
  server=createMcpServer(paths);client=new Client({name:'candidate-inspection-test',version:'1'});const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(a);await client.connect(b);
});
afterEach(async()=>{vi.restoreAllMocks();await client.close();await server.close();await rm(root,{recursive:true,force:true});});
function markdown(id='alpha.a',body='Fictional candidate body.',extras:object={}) {
  return '---\n'+stringify({schema_version:1,id,title:'Fictional candidate',summary:'Fictional pending observation.',type:'practice',scope:{kind:'repo',repo_id:'alpha'},status:'candidate',owner:'local-owner',sources:[],relationships:[],created_at:'2020-01-01T00:00:00Z',updated_at:'2020-01-01T00:00:00Z',...extras})+'---\n'+body;
}
async function call(name:string,args:Record<string,unknown>={}) {return client.callTool({name,arguments:args});}
async function ok(name:string,args:Record<string,unknown>={}) {const result=await call(name,args);expect(result.isError,JSON.stringify(result)).not.toBe(true);expect(result.structuredContent).toMatchObject({ok:true});return (result.structuredContent as any).data;}
async function error(name:string,args:Record<string,unknown>,code:string) {const result=await call(name,args);expect(result.isError).toBe(true);expect(result.structuredContent).toMatchObject({ok:false,data:{error:{code}}});return result;}
const submit=(id='alpha.a',body='Fictional candidate body.')=>ok('submit_learning',{repo_id:'alpha',idempotency_key:id,learning:{markdown:markdown(id,body)}});

it('AEF-013 advertises read-only candidate tools with operation-specific output schemas',async()=>{
  const tools=(await client.listTools()).tools;
  for(const name of ['list_candidates','get_candidate']) {
    const tool=tools.find(item=>item.name===name);expect(tool).toBeDefined();expect(tool?.annotations).toMatchObject({readOnlyHint:true,destructiveHint:false});
    expect(JSON.stringify(tool?.outputSchema)).toContain(name==='list_candidates'?'candidates':'content_hash');
  }
});
it('AEF-013 supports the real SDK submit/list/inspect/update/stale/reinspect cycle without publication',async()=>{
  await buildActiveGeneration(root,paths.runtimeRoot);const submitted=await submit();
  const listed=await ok('list_candidates',{repo_id:'alias-alpha'});expect(listed.candidates).toHaveLength(1);expect(listed.candidates[0]).toMatchObject({id:'alpha.a',repo_id:'alpha',state:'candidate',content_hash:submitted.content_hash});
  const inspected=await ok('get_candidate',{repo_id:'alpha',id:'alpha.a'});expect(inspected.markdown).toBe(markdown());expect(inspected.candidate.content_hash).toBe(submitted.content_hash);
  const edit={repo_id:'alpha',id:'alpha.a',expected_hash:inspected.candidate.content_hash,learning:{markdown:markdown('alpha.a','Corrected fictional observation.')}};
  const updated=await ok('update_candidate',edit);await error('update_candidate',edit,'CONFLICT');
  expect((await ok('get_candidate',{repo_id:'alpha',id:'alpha.a'})).candidate.content_hash).toBe(updated.content_hash);
  await error('get_knowledge',{repo_id:'alpha',id:'alpha.a'},'NOT_FOUND');expect((await ok('search_knowledge',{repo_id:'alpha',query:'Fictional'})).results).toEqual([]);
  expect(JSON.stringify(listed)+JSON.stringify(inspected)).not.toContain(root);
});
it('AEF-013 list pages are stable, bounded and reject a concurrent candidate edit',async()=>{
  await submit('alpha.b');await submit('alpha.a');const first=await ok('list_candidates',{limit:1});expect(first.candidates.map((item:any)=>item.id)).toEqual(['alpha.a']);expect(first.next_cursor).toEqual(expect.any(String));
  const second=await ok('list_candidates',{limit:1,cursor:first.next_cursor});expect(second.candidates.map((item:any)=>item.id)).toEqual(['alpha.b']);expect(second.next_cursor).toBeNull();
  const current=await ok('get_candidate',{repo_id:'alpha',id:'alpha.a'});await ok('update_candidate',{repo_id:'alpha',id:'alpha.a',expected_hash:current.candidate.content_hash,learning:{markdown:markdown('alpha.a','Changed between pages.')}});
  await error('list_candidates',{limit:1,cursor:first.next_cursor},'VALIDATION_ERROR');
});
it('AEF-013 reconstructs UTF-8 Markdown under complete-envelope byte/token caps',async()=>{
  const source=markdown('alpha.a','界🙂'.repeat(2000));await ok('submit_learning',{repo_id:'alpha',idempotency_key:'unicode',learning:{markdown:source}});
  let cursor:string|undefined,body='',pages=0;const hash=createHash('sha256').update(source).digest('hex');
  do {
    const data=await ok('get_candidate',{repo_id:'alpha',id:'alpha.a',max_bytes:2500,max_tokens:834,expected_hash:hash,...(cursor?{cursor}:{})});
    expect(Buffer.byteLength(JSON.stringify({ok:true,data}))).toBeLessThanOrEqual(2500);expect(data.markdown).not.toContain('\ufffd');expect(data.body_offset).toBe(Buffer.byteLength(body));expect(data.candidate.content_hash).toBe(hash);
    body+=data.markdown;cursor=data.next_cursor??undefined;expect(++pages).toBeLessThan(100);
  }while(cursor);
  expect(body).toBe(source);expect(pages).toBeGreaterThan(1);
  await error('get_candidate',{repo_id:'alpha',id:'alpha.a',expected_hash:'0'.repeat(64)},'CONFLICT');
});
it('AEF-013 authorizes before reading denied state and exposes no hidden paths or counts',async()=>{
  await submit();const directory=path.join(root,'candidates','vault');await mkdir(directory);await writeFile(path.join(directory,'private.md'),'malformed private sentinel '+root);
  const listed=await ok('list_candidates');expect(listed.candidates).toHaveLength(1);expect(JSON.stringify(listed)).not.toMatch(/vault|Private sentinel|malformed|candidate_path/);expect(JSON.stringify(listed)).not.toContain(root);
  const denied=await error('get_candidate',{repo_id:'vault',id:'private'},'NOT_FOUND');const missing=await error('get_candidate',{repo_id:'unknown',id:'private'},'NOT_FOUND');expect(denied.structuredContent).toEqual(missing.structuredContent);
  await error('list_candidates',{repo_id:'vault'},'NOT_FOUND');paths.config.principal='unrelated';await error('get_candidate',{repo_id:'alpha',id:'alpha.a'},'NOT_FOUND');expect((await ok('list_candidates')).candidates).toEqual([]);
});
it('AEF-013 empty inspection creates no ledger and does not recover pending writer journals',async()=>{
  expect((await ok('list_candidates')).candidates).toEqual([]);await expect(readFile(path.join(paths.runtimeRoot,'receipts.sqlite'))).rejects.toMatchObject({code:'ENOENT'});
  const receipt=await submit(),replacement=markdown('alpha.a','Pending writer replacement.');const ledger=new DatabaseSync(path.join(paths.runtimeRoot,'receipts.sqlite'));
  ledger.prepare('INSERT INTO candidate_updates VALUES (?,?,?,?,?,?)').run('alpha','alpha.a',receipt.content_hash,createHash('sha256').update(replacement).digest('hex'),replacement,path.join(root,'candidates','alpha','alpha.a.md'));ledger.close();
  expect((await ok('get_candidate',{repo_id:'alpha',id:'alpha.a'})).markdown).toBe(markdown());await ok('list_candidates');
  const reopened=new DatabaseSync(path.join(paths.runtimeRoot,'receipts.sqlite'),{readOnly:true});try{expect((reopened.prepare('SELECT COUNT(*) AS count FROM candidate_updates').get() as any).count).toBe(1);}finally{reopened.close();}
});
it('AEF-013 fails safely when minimum metadata cannot fit and rejects linked candidate roots',async()=>{
  await submit();for(const name of ['list_candidates','get_candidate'])await error(name,{repo_id:'alpha',...(name==='get_candidate'?{id:'alpha.a'}:{}),max_bytes:20},'CONTEXT_BUDGET_EXCEEDED');
  await rm(path.join(root,'candidates','alpha'),{recursive:true});const outside=path.join(root,'outside');await mkdir(outside);await symlink(outside,path.join(root,'candidates','alpha'),'junction');
  const result=await error('get_candidate',{repo_id:'alpha',id:'alpha.a'},'CANDIDATE_STATE_UNAVAILABLE');expect(JSON.stringify(result)).not.toContain(root);
});
it('AEF-013 validates direct inputs and never returns a success-shaped malformed operation output',async()=>{
  await expect(inspection.listCandidateSummaries(paths,{limit:NaN})).rejects.toMatchObject({code:'VALIDATION_ERROR'});
  await expect(inspection.readCandidate(paths,{repo_id:'alpha',id:'../escape'})).rejects.toMatchObject({code:'VALIDATION_ERROR'});
  await error('get_candidate',{repo_id:'alpha',id:'alpha.missing'},'NOT_FOUND');
  vi.spyOn(inspection,'readCandidate').mockResolvedValueOnce({candidate_path:root} as any);
  const result=await error('get_candidate',{repo_id:'alpha',id:'alpha.a'},'CANDIDATE_STATE_UNAVAILABLE');expect(JSON.stringify(result)).not.toContain(root);
});
it('AEF-013 limits inspection to applicable owned pending file state',async()=>{
  await submit();const directory=path.join(root,'candidates','alpha');
  const definitions: Array<[string,object,boolean]>=[['shared',{scope:{kind:'shared'}},true],['team',{scope:{kind:'team',team_id:'local'}},true],['cross',{scope:{kind:'cross-repo',repo_ids:['alpha','beta']}},true],['other-team',{scope:{kind:'team',team_id:'other'}},false],['other-repo',{scope:{kind:'repo',repo_id:'vault'}},false],['other-cross',{scope:{kind:'cross-repo',repo_ids:['vault','beta']}},false],['other-owner',{owner:'other-owner'},false],['verified',{status:'verified'},false]];
  for(const [suffix,extra,visible] of definitions){await writeFile(path.join(directory,'alpha.'+suffix+'.md'),markdown('alpha.'+suffix,'Fictional scoped pending data.',extra));if(visible)expect((await ok('get_candidate',{repo_id:'alias-alpha',id:'alpha.'+suffix})).candidate.repo_id).toBe('alpha');else await error('get_candidate',{repo_id:'alpha',id:'alpha.'+suffix},'NOT_FOUND');}
  expect((await ok('list_candidates')).candidates.map((item:any)=>item.id)).toEqual(['alpha.a','alpha.cross','alpha.shared','alpha.team']);
});
it('AEF-013 denied repository edits do not change owned listing continuations',async()=>{
  await submit('alpha.a');await submit('alpha.b');const first=await ok('list_candidates',{limit:1});await mkdir(path.join(root,'candidates','vault'));await writeFile(path.join(root,'candidates','vault','private.md'),'Private malformed text');
  const next=await ok('list_candidates',{limit:1,cursor:first.next_cursor});expect(next.snapshot).toBe(first.snapshot);expect(next.candidates[0].id).toBe('alpha.b');
});
it('AEF-013 invalidates body continuations after edits and rejects non-boundary offsets',async()=>{
  await submit('alpha.a','界🙂'.repeat(2000));const first=await ok('get_candidate',{repo_id:'alpha',id:'alpha.a',max_bytes:1500});
  const cursor=JSON.parse(Buffer.from(first.next_cursor,'base64url').toString('utf8'));cursor.offset++;
  await error('get_candidate',{repo_id:'alpha',id:'alpha.a',max_bytes:1500,cursor:Buffer.from(JSON.stringify(cursor)).toString('base64url')},'VALIDATION_ERROR');
  await ok('update_candidate',{repo_id:'alpha',id:'alpha.a',expected_hash:first.candidate.content_hash,learning:{markdown:markdown('alpha.a','Edited while paging.')}});
  await error('get_candidate',{repo_id:'alpha',id:'alpha.a',max_bytes:1500,cursor:first.next_cursor},'VALIDATION_ERROR');
});
it('AEF-013 bounds list envelopes and accepts a complete final body when it fits exactly',async()=>{
  for(const id of ['alpha.a','alpha.b','alpha.c'])await submit(id);
  const page=await ok('list_candidates',{max_bytes:1100});expect(page.candidates.length).toBeLessThan(3);expect(page.next_cursor).toEqual(expect.any(String));expect(Buffer.byteLength(JSON.stringify({ok:true,data:page}))).toBeLessThanOrEqual(1100);
  const full=await ok('get_candidate',{repo_id:'alpha',id:'alpha.a'});const exact=await ok('get_candidate',{repo_id:'alpha',id:'alpha.a',max_bytes:Buffer.byteLength(JSON.stringify({ok:true,data:full}))});expect(exact.markdown).toBe(markdown());expect(exact.next_cursor).toBeNull();
  await error('list_candidates',{max_tokens:1},'CONTEXT_BUDGET_EXCEEDED');
});
it('AEF-013 sanitizes malformed authorized candidate state instead of silently dropping it',async()=>{
  await submit();await writeFile(path.join(root,'candidates','alpha','alpha.bad.md'),'Invalid private diagnostic '+root);
  for(const name of ['list_candidates','get_candidate']){const result=await error(name,{repo_id:'alpha',...(name==='get_candidate'?{id:'alpha.bad'}:{})},'CANDIDATE_STATE_UNAVAILABLE');expect(JSON.stringify(result)).not.toContain(root);}
});
