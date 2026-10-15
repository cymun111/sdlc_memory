import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { resolvePaths, type ResolvedPaths } from '../../src/core/config.js';
import { buildActiveGeneration } from '../../src/indexing/build-index.js';
import { startSession, finishSession, resumeSession } from '../../src/capture/session.js';
import * as sessions from '../../src/capture/session.js';
import * as candidates from '../../src/capture/candidate-store.js';
import { KnowledgeService } from '../../src/retrieval/service.js';
import { stringify } from 'yaml';
const client=vi.hoisted(()=>({mode:'ok',phases:[] as string[]}));
vi.mock('node:child_process',async(original)=>{
  const actual=await original<typeof import('node:child_process')>();
  return {...actual,spawnSync:(command:string,args:string[],options:any)=>{
    if(args.includes('--version')) return {status:client.mode==='missing'?1:0,stdout:client.mode==='wrong-version'?'unsupported-client':'codex-cli synthetic-test',stderr:''};
    const prompt=options?.input?JSON.parse(options.input):{};client.phases.push(prompt.phase??'legacy');
    if(client.mode==='exit') return {status:17,signal:null,stdout:'',stderr:'private diagnostics'};
    if(client.mode==='interrupt') return {status:null,signal:'SIGTERM',stdout:'',stderr:''};
    if(client.mode==='execute-exit' && prompt.phase==='execute-task')return {status:9,signal:null,stdout:'',stderr:''};
    const outputIndex=args.indexOf('--output-last-message');const output=outputIndex<0?undefined:args[outputIndex+1];
    if(output && client.mode!=='empty') {
      const filesystem=process.getBuiltinModule('node:fs');
      const learning='---\n'+stringify({schema_version:1,id:'alpha.session-learning',title:'Fictional completion',summary:'A fictional durable observation',type:'practice',scope:{kind:'repo',repo_id:'alpha'},status:'candidate',owner:'local-owner',sources:[],relationships:[],created_at:'2020-01-01T00:00:00Z',updated_at:'2020-01-01T00:00:00Z'})+'---\nFictional evidence, not a real project claim.';
      const result=prompt.phase==='consume-context'?{schema_version:1,session_id:prompt.session_id,context_digest:client.mode==='bad-ack'?'wrong':prompt.context_digest,index_generation:prompt.context.index_generation,records:prompt.context.results.map((item:any)=>({id:item.id,summary:item.summary}))}:{schema_version:1,session_id:prompt.session_id,context_digest:prompt.context_digest,outcome:client.mode==='learning'?'learning':'no-learning',markdown:client.mode==='learning'?learning:null};
      filesystem.writeFileSync(output,client.mode==='malformed'?'{bad json':JSON.stringify(result));
    }
    return {status:0,signal:null,stdout:client.mode==='missing-event'?'not an event':'{"type":"turn.completed"}\n',stderr:''};
  }};
});
let root:string,paths:ResolvedPaths,taskFile:string;
beforeEach(async()=>{
  client.mode='ok';client.phases=[];root=await mkdtemp(path.join(os.tmpdir(),'verified-session-'));await mkdir(path.join(root,'schemas'));await mkdir(path.join(root,'knowledge'));await copyFile('schemas/knowledge.schema.json',path.join(root,'schemas/knowledge.schema.json'));
  execFileSync('git',['init',root],{stdio:'ignore'});execFileSync('git',['-C',root,'-c','user.name=Fixture','-c','user.email=fixture@invalid','commit','--allow-empty','-m','Fictional fixture'],{stdio:'ignore'});
  paths=await resolvePaths({root});paths.config.repositories=[{id:'alpha',name:'Alpha',owner:'local-owner',team:'local',aliases:[],path:root}];await buildActiveGeneration(root,paths.runtimeRoot);taskFile=path.join(root,'task.txt');await writeFile(taskFile,'Report a fictional no-learning completion.');
});
afterEach(async()=>{vi.restoreAllMocks();await rm(root,{recursive:true,force:true});});
const start=(extra:object={})=>startSession(paths,{repoId:'alpha',agent:'codex',taskFile,launcher:'synthetic-client',...extra});
it('AEF-012 requires a verified context acknowledgement before releasing the task',async()=>{
  const receipt=await start();expect(client.phases).toEqual(['consume-context','execute-task']);
  expect(receipt.state).toBe('completed-no-learning');expect(receipt).toMatchObject({schema_version:1,adapter:{id:'codex-exec-v1',real_client_verified:false},delivery:{consumed:true,acknowledgement_verified:true}});
});
it('AEF-012 blocks planning after an invalid acknowledgement',async()=>{
  client.mode='bad-ack';const receipt=await start();expect(receipt.state).toBe('invalid-context-acknowledgement');expect(client.phases).toEqual(['consume-context']);
});
it.each([['exit','agent-exited-with-error'],['interrupt','interrupted'],['malformed','malformed-output']])('AEF-012 preserves distinct %s outcomes',async(mode,state)=>{
  client.mode=mode!;const receipt=await start();expect(receipt.state).toBe(state);
  expect(JSON.parse(await readFile(path.join(paths.runtimeRoot,'sessions',receipt.session_id,'receipt.json'),'utf8')).state).toBe(state);
});
it('AEF-012 prepare-only cannot claim context consumption',async()=>{
  const receipt=await start({prepareOnly:true});expect(client.phases).toEqual([]);expect(receipt).toMatchObject({delivery:{consumed:false,acknowledgement_verified:false}});
});
it('AEF-012 rejects unvalidated completion fields and keeps prior durable state',async()=>{
  const receipt=await start({prepareOnly:true});await writeFile(receipt.result_file,JSON.stringify({outcome:'no-learning',unexpected:'ignored before AEF-012'}));
  await expect(finishSession(paths,receipt.session_id,receipt.result_file)).rejects.toMatchObject({code:'VALIDATION_ERROR'});
});
it('AEF-012 no-learning completion replays durably and changed completion conflicts',async()=>{
  const receipt=await start();const replay=await finishSession(paths,receipt.session_id,receipt.result_file);expect(replay.state).toBe('completed-no-learning');
  const data=JSON.parse(await readFile(receipt.result_file,'utf8'));await writeFile(receipt.result_file,JSON.stringify({...data,outcome:'learning',markdown:'changed'}));
  await expect(finishSession(paths,receipt.session_id,receipt.result_file)).rejects.toMatchObject({code:'CONFLICT'});
});
it('AEF-012 blocks mandatory-policy review before any client launch',async()=>{
  const original=KnowledgeService.prototype.taskContext;vi.spyOn(KnowledgeService.prototype,'taskContext').mockImplementation(async function(this: KnowledgeService,input){return {...await original.call(this,input),status:'POLICY_REVIEW_REQUIRED'};});
  expect((await start()).state).toBe('blocked-context');expect(client.phases).toEqual([]);
});
it('AEF-012 bounds retries across restarts and preserves the same session identity',async()=>{
  client.mode='bad-ack';const receipt=await start();await resumeSession(paths,receipt.session_id,'synthetic-client');await resumeSession(paths,receipt.session_id,'synthetic-client');
  const exhausted=await resumeSession(paths,receipt.session_id,'synthetic-client');expect(exhausted.state).toBe('retry-exhausted');expect(exhausted.attempts).toBe(3);expect(client.phases).toHaveLength(3);
});
it('AEF-012 reopens a failed intake without relaunching or duplicating learning',async()=>{
  client.mode='learning';vi.spyOn(candidates,'submitCandidate').mockRejectedValueOnce(new candidates.DomainError('SOURCE_UNAVAILABLE','Injected intake outage'));
  const receipt=await start();expect(receipt.state).toBe('capture-failed');const phases=client.phases.length;
  const recovered=await resumeSession(paths,receipt.session_id,'synthetic-client');expect(recovered.state).toBe('completed-candidate-submitted');expect(client.phases).toHaveLength(phases);
  await finishSession(paths,receipt.session_id,receipt.result_file);expect(await candidates.listCandidates(paths,'alpha')).toHaveLength(1);
});
it('AEF-012 explicitly blocks resumed planning after a changed index generation',async()=>{
  const receipt=await start({prepareOnly:true});await buildActiveGeneration(root,paths.runtimeRoot);
  expect((await resumeSession(paths,receipt.session_id,'synthetic-client')).state).toBe('blocked-context');expect(client.phases).toEqual([]);
});
it('AEF-012 installs/removes only owned runtime adapter configuration and preserves external edits',async()=>{
  const configure=(sessions as any).configureSessionAdapter;
  const installed=await configure(paths,{action:'install'});expect(installed.state).toBe('installed');
  const unrelated=path.join(paths.runtimeRoot,'unrelated.json');await writeFile(unrelated,'{"keep":true}');
  await configure(paths,{action:'uninstall'});expect(await readFile(unrelated,'utf8')).toBe('{"keep":true}');
  const next=await configure(paths,{action:'install'});await writeFile(next.path,'{"external":"edit"}');
  await expect(configure(paths,{action:'uninstall'})).rejects.toMatchObject({code:'CONFLICT'});expect(await readFile(next.path,'utf8')).toContain('external');
});
it('AEF-012 refuses modified installed adapter configuration before launching',async()=>{
  const installed=await (sessions as any).configureSessionAdapter(paths,{action:'install'});await writeFile(installed.path,'{"external":"edit"}');
  await expect(startSession(paths,{repoId:'alpha',agent:'codex',taskFile})).rejects.toMatchObject({code:'CONFLICT'});expect(client.phases).toEqual([]);
});
it.each([['missing','blocked-client-unavailable'],['empty','malformed-output'],['missing-event','invalid-context-acknowledgement'],['execute-exit','agent-exited-with-error']])('AEF-012 preserves %s client failures',async(mode,state)=>{
  client.mode=mode!;expect((await start()).state).toBe(state);
});
it('AEF-012 rejects unsupported identity and empty task inputs before client execution',async()=>{
  await expect(start({agent:'unverified-client'})).rejects.toMatchObject({code:'VALIDATION_ERROR'});
  await expect(start({repoId:'missing'})).rejects.toMatchObject({code:'NOT_FOUND'});
  await writeFile(taskFile,'');await expect(start()).rejects.toMatchObject({code:'VALIDATION_ERROR'});expect(client.phases).toEqual([]);
});
it('AEF-012 refuses invalid and differently owned session receipts',async()=>{
  await expect(resumeSession(paths,'../escape')).rejects.toMatchObject({code:'VALIDATION_ERROR'});
  const receipt=await start({prepareOnly:true});paths.config.principal='other-user';
  await expect(resumeSession(paths,receipt.session_id,'synthetic-client')).rejects.toMatchObject({code:'VALIDATION_ERROR'});
});
it('AEF-012 retains bounded capture failures for operator review',async()=>{
  client.mode='learning';vi.spyOn(candidates,'submitCandidate').mockRejectedValue(new candidates.DomainError('SOURCE_UNAVAILABLE','Injected intake outage'));
  const receipt=await start();
  await expect(resumeSession(paths,receipt.session_id,'synthetic-client')).rejects.toMatchObject({code:'SOURCE_UNAVAILABLE'});
  await expect(resumeSession(paths,receipt.session_id,'synthetic-client')).rejects.toMatchObject({code:'SOURCE_UNAVAILABLE'});
  await expect(resumeSession(paths,receipt.session_id,'synthetic-client')).rejects.toMatchObject({code:'CONFLICT'});
  const saved=JSON.parse(await readFile(path.join(paths.runtimeRoot,'sessions',receipt.session_id,'receipt.json'),'utf8'));expect(saved.capture_attempts).toBe(3);expect(saved.state).toBe('capture-failed');
});
it('AEF-012 adapter install is idempotent, version-checked and independently inspectable',async()=>{
  const configure=(sessions as any).configureSessionAdapter;
  expect((await configure(paths,{action:'status'})).state).toBe('uninstalled');
  await configure(paths,{action:'install'});expect((await configure(paths,{action:'install'})).state).toBe('installed');expect((await configure(paths,{action:'status'})).state).toBe('installed');
  await configure(paths,{action:'uninstall'});await configure(paths,{action:'uninstall'});
  client.mode='wrong-version';await expect(configure(paths,{action:'install'})).rejects.toMatchObject({code:'SOURCE_UNAVAILABLE'});
  await expect(configure(paths,{action:'invalid'})).rejects.toMatchObject({code:'VALIDATION_ERROR'});
});
it('AEF-012 rechecks policy context after acknowledgement before task release',async()=>{
  const original=KnowledgeService.prototype.taskContext;let calls=0;
  vi.spyOn(KnowledgeService.prototype,'taskContext').mockImplementation(async function(this:KnowledgeService,input){const context=await original.call(this,input);return ++calls>=3?{...context,status:'POLICY_REVIEW_REQUIRED'}:context;});
  expect((await start()).state).toBe('blocked-context');expect(client.phases).toEqual(['consume-context']);
});
it('AEF-012 preserves an incomplete adapter installation owned by another principal',async()=>{
  const installed=await (sessions as any).configureSessionAdapter(paths,{action:'install'});await rm(installed.path);paths.config.principal='other-principal';
  await expect((sessions as any).configureSessionAdapter(paths,{action:'uninstall'})).rejects.toMatchObject({code:'FORBIDDEN'});
});
