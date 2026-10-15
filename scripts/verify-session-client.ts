// Explicit operator-run integration check. Uses the authenticated real Codex CLI;
// never imported by the test suite or run automatically during installation.
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stringify } from 'yaml';
import { resolvePaths } from '../src/core/config.js';
import { buildActiveGeneration } from '../src/indexing/build-index.js';
import { startSession, finishSession, configureSessionAdapter } from '../src/capture/session.js';
import { listCandidates } from '../src/capture/candidate-store.js';

const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.join(project,'.runtime','aef-012-client-verification.json');
const temporary=await mkdtemp(path.join(os.tmpdir(),'sdlc-session-client-'));
try {
  const source=path.join(temporary,'fictional source'),root=path.join(temporary,'knowledge');
  await mkdir(source);await mkdir(path.join(root,'schemas'),{recursive:true});await mkdir(path.join(root,'knowledge'));
  await copyFile(path.join(project,'schemas','knowledge.schema.json'),path.join(root,'schemas','knowledge.schema.json'));
  const git=(...args:string[])=>execFileSync('git',['-C',source,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  git('init');git('-c','user.name=Fictional verification','-c','user.email=fixture@invalid','commit','--allow-empty','-m','Fictional session verification');
  const policy={schema_version:1,id:'fictional.cache-policy',title:'Fictional cache policy',summary:'Fictional verification requires keeping cache keys scoped.',type:'approved-policy',scope:{kind:'repo',repo_id:'fictional'},status:'verified',owner:'local-owner',sources:[{kind:'decision',url:'https://fictional.invalid/approval/1',approver:'local-owner',approved_at:'2020-01-01T00:00:00Z'}],relationships:[],created_at:'2020-01-01T00:00:00Z',updated_at:'2020-01-01T00:00:00Z'};
  await writeFile(path.join(root,'knowledge','policy.md'),'---\n'+stringify(policy)+'---\nFictional fixture, not a real organizational policy.');
  const paths=await resolvePaths({root});paths.config.repositories=[{id:'fictional',name:'Fictional verification',path:source,owner:'local-owner',team:'local',aliases:[]}];
  await buildActiveGeneration(root,paths.runtimeRoot);
  await writeFile(path.join(paths.runtimeRoot,'unrelated.json'),'{"preserve":true}');
  await configureSessionAdapter(paths,{action:'install'});
  const taskFile=path.join(temporary,'task.txt');
  await writeFile(taskFile,'Verify fictional cache context acknowledgement and return no-learning with markdown null. Do not run commands or edit files. This is a synthetic adapter protocol check.');
  const noLearning=await startSession(paths,{repoId:'fictional',agent:'codex',taskFile});
  const learning={...policy,id:'fictional.protocol-learning',title:'Fictional protocol fixture',summary:'This synthetic fixture verifies session candidate capture.',type:'practice',status:'candidate',sources:[{kind:'documentation',reference:'https://fictional.invalid/protocol-fixture'}]};
  const markdown='---\n'+stringify(learning)+'---\nSynthetic protocol test artifact, not a real application assertion.';
  await writeFile(taskFile,'Protocol check only: emit outcome learning with the following exact fictional candidate Markdown. Do not run commands or edit files. Never describe this as actual project knowledge. Markdown: '+JSON.stringify(markdown));
  const captured=await startSession(paths,{repoId:'fictional',agent:'codex',taskFile});
  if(noLearning.state!=='completed-no-learning' || captured.state!=='completed-candidate-submitted' || !noLearning.adapter.real_client_verified || !captured.adapter.real_client_verified)throw new Error('Real client session verification failed; no success claim recorded.');
  const replay=await finishSession(paths,captured.session_id,captured.result_file);
  const candidates=await listCandidates(paths,'fictional');
  await configureSessionAdapter(paths,{action:'uninstall'});
  const preserved=await readFile(path.join(paths.runtimeRoot,'unrelated.json'),'utf8')==='{"preserve":true}';
  if(candidates.length!==1 || git('status','--porcelain')!=='' || !preserved || replay.state!==captured.state)throw new Error('Replay, read-only source or uninstall verification failed.');
  const compact=(receipt:typeof captured)=>({session_id:receipt.session_id,state:receipt.state,source_revision:receipt.source_revision,knowledge_revision:receipt.context_receipt.knowledge_revision,index_generation:receipt.context_receipt.index_generation,result_ids:receipt.context_receipt.results.map(item=>item.id),adapter:receipt.adapter,delivery:receipt.delivery,completion_hash:receipt.completion_hash,attempts:receipt.attempts,capture_attempts:receipt.capture_attempts});
  const report={schema_version:1,verified_at:new Date().toISOString(),platform:process.platform,node:process.version,fixture:'Fresh isolated Git repository, spaced path, fictional policy and explicit fictional candidate; no real project assertions.',no_learning:compact(noLearning),learning:compact(captured),replay_candidate_count:candidates.length,source_worktree_unchanged:true,unrelated_settings_preserved:preserved,limitations:['Two separate read-only Codex exec invocations per task; acknowledgement proves protocol consumption, not internal reasoning.','No global/native hook edits or SDLC Command wiring; generated MCP templates remain separate.']};
  await mkdir(path.dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({output,...report},null,2));
} finally {await rm(temporary,{recursive:true,force:true});}
