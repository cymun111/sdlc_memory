import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { stringify } from 'yaml';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { resolvePaths, type ResolvedPaths } from '../../src/core/config.js';
import { submitCandidate, listCandidates, updateCandidate } from '../../src/capture/candidate-store.js';
import { rejectCandidate, approveCandidate } from '../../src/capture/review.js';
const fault=vi.hoisted(()=>({destination:'',remove:'',archive:false,replace:'',replacement:''}));
vi.mock('node:fs',async(original)=>{
  const actual=await original<typeof import('node:fs')>();
  return {...actual,
    writeFileSync:(...args:Parameters<typeof actual.writeFileSync>)=>{const result=actual.writeFileSync(...args);if(fault.replace && String(args[0]).startsWith(fault.replace+'.')){const file=fault.replace;fault.replace='';actual.writeFileSync(file,fault.replacement);}return result;},
    linkSync:(...args:Parameters<typeof actual.linkSync>)=>{if(String(args[1])===fault.destination) throw new Error('Injected creation interruption'); return actual.linkSync(...args);},
    renameSync:(...args:Parameters<typeof actual.renameSync>)=>{if(String(args[1])===fault.destination || fault.archive) throw new Error('Injected rename interruption'); return actual.renameSync(...args);},
    rmSync:(...args:Parameters<typeof actual.rmSync>)=>{if(String(args[0])===fault.remove) throw new Error('Injected removal interruption'); return actual.rmSync(...args);}
  };
});
let root:string, paths:ResolvedPaths;
beforeEach(async()=>{
  root=await mkdtemp(path.join(os.tmpdir(),'safe-capture-')); await mkdir(path.join(root,'schemas'));
  await copyFile('schemas/knowledge.schema.json',path.join(root,'schemas/knowledge.schema.json'));
  paths=await resolvePaths({root}); paths.config.repositories=[{id:'alpha',name:'Alpha',owner:'local-owner',team:'local',aliases:[],path:root}];
});
afterEach(async()=>{fault.destination='';fault.remove='';fault.archive=false;fault.replace='';fault.replacement='';await rm(root,{recursive:true,force:true});});
function markdown(body='Fictional durable observation.') {return '---\n'+stringify({schema_version:1,id:'alpha.learning',title:'Fictional learning',summary:'Fictional summary',type:'practice',scope:{kind:'repo',repo_id:'alpha'},status:'candidate',owner:'local-owner',sources:[],relationships:[],created_at:'2020-01-01T00:00:00Z',updated_at:'2020-01-01T00:00:00Z'})+'---\n'+body;}
const submit=(body=markdown())=>submitCandidate(paths,{repoId:'alpha',idempotencyKey:'task:1',markdown:body});
it('AEF-011 caps UTF-8 bytes before any candidate or ledger write',async()=>{
  await expect(submit(markdown('界'.repeat(23000)))).rejects.toMatchObject({code:'VALIDATION_ERROR'});
  await expect(readFile(path.join(paths.runtimeRoot,'receipts.sqlite'))).rejects.toMatchObject({code:'ENOENT'});
});
it.each(['-----BEGIN PRIVATE KEY-----\nfictional\n-----END PRIVATE KEY-----','ghp_'+'x'.repeat(36),'AKIA'+'X'.repeat(16)])('AEF-011 rejects recognizable secret material with sanitized diagnostics: %s',async(secret)=>{
  let error:unknown; try{await submit(markdown(secret));}catch(value){error=value;}
  expect(error).toMatchObject({code:'VALIDATION_ERROR'}); expect(String(error)).not.toContain(secret);
});
it('AEF-011 screens replacement Markdown as well as initial intake',async()=>{
  const receipt=await submit(); await expect(updateCandidate(paths,{repoId:'alpha',id:receipt.candidate_id,expectedHash:receipt.content_hash,markdown:markdown('ghp_'+'x'.repeat(36))})).rejects.toMatchObject({code:'VALIDATION_ERROR'});
});
it('AEF-011 rejects linked runtime roots before creating a ledger',async()=>{
  const outside=path.join(root,'outside'); await mkdir(outside); await symlink(outside,paths.runtimeRoot,'junction');
  await expect(submit()).rejects.toMatchObject({code:'FORBIDDEN'});
  await expect(readFile(path.join(outside,'receipts.sqlite'))).rejects.toMatchObject({code:'ENOENT'});
});
it('AEF-011 candidate listing does not follow linked repository directories',async()=>{
  const outside=path.join(root,'outside'); await mkdir(outside); await writeFile(path.join(outside,'alpha.learning.md'),markdown());
  await mkdir(path.join(root,'candidates')); await symlink(outside,path.join(root,'candidates','alpha'),'junction');
  await expect(listCandidates(paths,'alpha')).rejects.toMatchObject({code:'FORBIDDEN'});
});
it('AEF-011 rejects nonregular candidate paths on idempotent replay',async()=>{
  const receipt=await submit(); await rm(receipt.candidate_path); await mkdir(receipt.candidate_path);
  await expect(submit()).rejects.toMatchObject({code:'FORBIDDEN'});
});
it('AEF-011 retains rejection evidence in the versionable candidate tree',async()=>{
  const receipt=await submit(); const result=await rejectCandidate(paths,{id:receipt.candidate_id,expectedHash:receipt.content_hash,reason:'Fictional unsupported evidence'});
  expect(result.archive_path.startsWith(path.join(root,'candidates')+path.sep)).toBe(true);
  const history=JSON.parse(await readFile(path.join(path.dirname(result.archive_path),'decision.json'),'utf8'));
  expect(history).toMatchObject({state:'rejected',reason:'Fictional unsupported evidence',content_hash:receipt.content_hash});
  expect(await readFile(result.archive_path,'utf8')).toBe(markdown());
});
it('AEF-011 reopens and completes interrupted candidate creation without caller payload replay',async()=>{
  fault.destination=path.join(root,'candidates','alpha','alpha.learning.md'); await expect(submit()).rejects.toThrow(/Injected/); fault.destination='';
  expect((await listCandidates(paths,'alpha')).map(item=>item.id)).toEqual(['alpha.learning']);
  expect((await submit()).duplicate).toBe(true);
});
it.each(['published','rejected'] as const)('AEF-011 reopens interrupted %s filesystem-ledger transitions',async(state)=>{
  const body=markdown().replace('sources: []','sources:\n  - kind: documentation\n    reference: https://fictional.invalid/evidence');
  const receipt=await submit(body); fault.remove=receipt.candidate_path; fault.archive=true;
  const action=()=>state==='published'?approveCandidate(paths,{id:receipt.candidate_id,expectedHash:receipt.content_hash}):rejectCandidate(paths,{id:receipt.candidate_id,expectedHash:receipt.content_hash,reason:'Fictional rejected claim'});
  await expect(action()).rejects.toThrow(/Injected/);fault.remove='';fault.archive=false;
  expect(await listCandidates(paths,'alpha')).toEqual([]);
  expect((await submit(body)).state).toBe(state);
});
it('AEF-011 interrupted creation refuses an unrelated external file',async()=>{
  fault.destination=path.join(root,'candidates','alpha','alpha.learning.md');await expect(submit()).rejects.toThrow();
  const filename=fault.destination;fault.destination='';await writeFile(filename,markdown('Unrelated external edit.'));
  await expect(listCandidates(paths,'alpha')).rejects.toMatchObject({code:'CONFLICT'});
  expect(await readFile(filename,'utf8')).toContain('Unrelated external edit.');
});
it('AEF-011 preserves replacement races detected after update staging',async()=>{
  const receipt=await submit();fault.replace=receipt.candidate_path;fault.replacement=markdown('Concurrent external edit.');
  await expect(updateCandidate(paths,{repoId:'alpha',id:receipt.candidate_id,expectedHash:receipt.content_hash,markdown:markdown('Proposed update.')})).rejects.toMatchObject({code:'CONFLICT'});
  expect(await readFile(receipt.candidate_path,'utf8')).toContain('Concurrent external edit.');
});
it('AEF-011 rejects unauthorized rejection without changing candidate history',async()=>{
  const receipt=await submit();paths.config.owner='other-owner';
  await expect(rejectCandidate(paths,{id:receipt.candidate_id,expectedHash:receipt.content_hash,reason:'Unauthorized review'})).rejects.toMatchObject({code:'FORBIDDEN'});
  expect(await readFile(receipt.candidate_path,'utf8')).toBe(markdown());
});
