import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { resolvePaths, type ResolvedPaths } from '../../src/core/config.js';
import { buildActiveGeneration } from '../../src/indexing/build-index.js';
import { startSession, finishSession } from '../../src/capture/session.js';
const client=vi.hoisted(()=>({mode:'ok',phases:[] as string[]}));
vi.mock('node:child_process',async(original)=>{
  const actual=await original<typeof import('node:child_process')>();
  return {...actual,spawnSync:(command:string,args:string[],options:any)=>{
    if(args.includes('--version')) return {status:0,stdout:'codex-cli synthetic-test',stderr:''};
    const prompt=options?.input?JSON.parse(options.input):{};client.phases.push(prompt.phase??'legacy');
    if(client.mode==='exit') return {status:17,signal:null,stdout:'',stderr:'private diagnostics'};
    if(client.mode==='interrupt') return {status:null,signal:'SIGTERM',stdout:'',stderr:''};
    const output=args[args.indexOf('--output-last-message')+1];
    if(output) {
      const filesystem=process.getBuiltinModule('node:fs');
      const result=prompt.phase==='consume-context'?{schema_version:1,session_id:prompt.session_id,context_digest:client.mode==='bad-ack'?'wrong':prompt.context_digest,index_generation:prompt.context.index_generation,records:prompt.context.results.map((item:any)=>({id:item.id,summary:item.summary}))}:{schema_version:1,session_id:prompt.session_id,context_digest:prompt.context_digest,outcome:'no-learning',markdown:null};
      filesystem.writeFileSync(output,client.mode==='malformed'?'{bad json':JSON.stringify(result));
    }
    return {status:0,signal:null,stdout:'{"type":"turn.completed"}\n',stderr:''};
  }};
});
let root:string,paths:ResolvedPaths,taskFile:string;
beforeEach(async()=>{
  client.mode='ok';client.phases=[];root=await mkdtemp(path.join(os.tmpdir(),'verified-session-'));await mkdir(path.join(root,'schemas'));await mkdir(path.join(root,'knowledge'));await copyFile('schemas/knowledge.schema.json',path.join(root,'schemas/knowledge.schema.json'));
  execFileSync('git',['init',root],{stdio:'ignore'});execFileSync('git',['-C',root,'-c','user.name=Fixture','-c','user.email=fixture@invalid','commit','--allow-empty','-m','Fictional fixture'],{stdio:'ignore'});
  paths=await resolvePaths({root});paths.config.repositories=[{id:'alpha',name:'Alpha',owner:'local-owner',team:'local',aliases:[],path:root}];await buildActiveGeneration(root,paths.runtimeRoot);taskFile=path.join(root,'task.txt');await writeFile(taskFile,'Report a fictional no-learning completion.');
});
afterEach(async()=>{await rm(root,{recursive:true,force:true});});
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
