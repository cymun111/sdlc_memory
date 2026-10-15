import { expect, it } from 'vitest';
import { rankMatch, terms, ftsAlternatives } from '../../src/retrieval/ranking.js';
import { measured, envelopeBytes, fits, offsetFor, continuation, checkGeneration, utf8End } from '../../src/retrieval/budget.js';
import type { KnowledgeRecord } from '../../src/core/types.js';

const record: KnowledgeRecord = {schema_version:1,id:'alpha.cache',type:'practice',status:'verified',owner:'local-owner',created_at:'2020-01-01T00:00:00Z',updated_at:'2020-01-01T00:00:00Z',relationships:[],title:'Cache expiry',summary:'Cache expiry removes entries',tags:['retention'],sources:[{kind:'code',path:'src/cache.ts',symbol:'expireCache'}],scope:{kind:'repo',repo_id:'alpha'}};
it('normalizes accents/plurals, bounds query terms, and quotes lexical alternatives',()=>{
  expect(terms('THE Rétries pictures')).toEqual(['retrie','image']);
  expect(terms(Array.from({length:100},(_,i)=>'term'+i).join(' '))).toHaveLength(32);
  expect(ftsAlternatives({task:'retry'})).toContain('"reattempt"');
  expect(ftsAlternatives({task:'the'})).toBe('""');
});
it('keeps field weights, independent topics, directory paths, and scope priorities deterministic',()=>{
  expect(rankMatch(record,'cache expiry',{task:'cache expiry'}).score).toBe(32);
  expect(rankMatch(record,'',{task:'unrelated',topics:['retention']}).reasons).toContain('topic:tag');
  expect(rankMatch(record,'',{task:'unrelated',changed_paths:['src/']}).reasons).toContain('changed-path:directory');
  expect(rankMatch(record,'',{task:'expireCache'}).reasons).toContain('source:symbol');
  for (const [kind,prior] of [['cross-repo',3],['team',2],['shared',1]] as const)
    expect(rankMatch({...record,scope:{kind} as KnowledgeRecord['scope']},'',{task:'cache expiry'}).score).toBe(26+prior);
  expect(rankMatch(record,'',{task:'unrelated'})).toEqual({score:0,reasons:[]});
});
it('measures the entire escaped multibyte envelope to a stable token estimate',()=>{
  const result=measured({body:'界🙂\n"\\'});
  expect(result.estimated_tokens).toBe(Math.ceil(envelopeBytes(result)/3));
  expect(fits(result,{bytes:envelopeBytes(result),tokens:result.estimated_tokens})).toBe(true);
  expect(fits(result,{bytes:envelopeBytes(result)-1,tokens:8000})).toBe(false);
  expect(fits(result,{bytes:32768,tokens:result.estimated_tokens-1})).toBe(false);
});
it('validates cursors, bounds offsets and rejects generation changes explicitly',()=>{
  expect(offsetFor(undefined,'key',10)).toBe(0);
  expect(offsetFor(continuation('key',2),'key',10)).toBe(2);
  for(const cursor of ['***',continuation('old',2),continuation('key',10),continuation('key',0),Buffer.from('null').toString('base64url')])
    expect(()=>offsetFor(cursor,'key',10)).toThrow(/Invalid or stale/);
  expect(()=>checkGeneration('new','old')).toThrow(/generation changed/);
  expect(()=>checkGeneration('new','new')).not.toThrow();
});
it('cuts UTF-8 only at code point boundaries',()=>{
  const bytes=Buffer.from('界🙂');
  expect([0,1,2,3,4,5,6,7,10].map((end)=>utf8End(bytes,end))).toEqual([0,0,0,3,3,3,3,7,7]);
});
