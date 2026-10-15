import type { KnowledgeRecord } from '../core/types.js';
export const rankingVersion = 'weighted-lexical-1';
const stop = new Set('a an the to of for and or in on with from is are be this that please inspect implementation safely'.split(' '));
const groups = [
  ['retry','replay','reattempt','resend'], ['idempotency','idempotent','duplicate','deduplicate','deduplication'],
  ['balance','money','fund'], ['reconciliation','reconcile','compare','comparison'], ['export','save'],
  ['image','picture','photo'], ['cache','caching'], ['remove','delete','deletion'], ['timeout','deadline']
];
export const normalize = (value: string) => value.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase();
const singular = (value: string) => value.length > 4 && value.endsWith('s') ? value.slice(0,-1) : value;
const canonical = (value: string) => groups.find((group) => group.includes(singular(value)))?.[0] ?? singular(value);
export function terms(value: string): string[] {
  return [...new Set((normalize(value).match(/[\p{L}\p{N}]+/gu)??[]).filter((word) => !stop.has(word)).slice(0,32).map(canonical))];
}
export interface RankingSignals { task: string; topics?: string[]; changed_paths?: string[] }
export function ftsAlternatives(signals: RankingSignals): string {
  const values = [...terms(signals.task),...(signals.topics??[]).slice(0,32).flatMap(terms)];
  const expanded = [...new Set(values.flatMap((word) => groups.find((group) => group[0] === word)??[word,word+'s']))].slice(0,64);
  return expanded.length ? expanded.map((word) => '"'+word+'"').join(' OR ') : '""';
}
export function rankMatch(record: KnowledgeRecord, body: string, signals: RankingSignals) {
  const title = new Set(terms(record.title)); const summary = new Set(terms(record.summary)); const narrative = new Set(terms(body.slice(0,16384)));
  const tags = (record.tags??[]).slice(0,64).map(normalize);
  const sources = record.sources.slice(0,100);
  const paths = sources.flatMap((source) => typeof source.path === 'string' ? [source.path] : []);
  const symbols = sources.flatMap((source) => typeof source.symbol === 'string' ? [normalize(source.symbol)] : []);
  const reasons = new Set<string>(); let score = 0;
  const matchText = (query: string, prefix: string, weight: number) => {
    const queryTerms = terms(query); let matched = 0; let subtotal = 0; const hits = new Set<string>();
    for (const word of queryTerms) {
      let found = false;
      for (const [set,amount,label] of [[title,8,'title'],[summary,5,'summary'],[narrative,1,'body']] as const) {
        if (set.has(word)) { subtotal += amount*weight; hits.add(prefix+':'+label); found = true; }
      }
      if (found) matched++;
    }
    if (!queryTerms.length || matched/queryTerms.length < 0.6) return false;
    score += subtotal; for (const hit of hits) reasons.add(hit); return true;
  };
  const lexical = matchText(signals.task,'task',1);
  let strong = false;
  for (const topic of (signals.topics??[]).slice(0,32)) {
    if (matchText(topic,'topic',1.5)) strong = true;
    if (tags.includes(normalize(topic))) { score += 30; reasons.add('topic:tag'); strong = true; }
    if (symbols.includes(normalize(topic))) { score += 40; reasons.add('source:symbol'); strong = true; }
  }
  for (const word of terms(signals.task)) if (tags.includes(word) || symbols.includes(word)) { score += 24; reasons.add(tags.includes(word)?'task:tag':'source:symbol'); strong = true; }
  for (const changed of (signals.changed_paths??[]).slice(0,100)) {
    if (paths.includes(changed)) { score += 60; reasons.add('changed-path:exact'); strong = true; }
    else if (paths.some((source) => source.startsWith(changed.replace(/\/$/,'')+'/'))) { score += 20; reasons.add('changed-path:directory'); strong = true; }
  }
  if (!lexical && !strong) return {score:0,reasons:[]};
  score += record.scope.kind === 'repo' ? 4 : record.scope.kind === 'cross-repo' ? 3 : record.scope.kind === 'team' ? 2 : 1;
  reasons.add('scope:'+record.scope.kind);
  return {score,reasons:[...reasons].sort()};
}
