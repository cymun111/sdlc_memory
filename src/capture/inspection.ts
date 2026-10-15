import { existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import type { RegisteredRepo, ResolvedPaths } from '../core/config.js';
import type { KnowledgeRecord } from '../core/types.js';
import { contextOutput } from '../application/contracts.js';
import { parseKnowledgeMarkdown } from '../validation/record.js';
import { DomainError } from './candidate-store.js';
import { safePath, readCapture } from './safety.js';
import { readOptions, measured, limits, fits, budgetError, snapshot, continuation, offsetFor, utf8End } from '../retrieval/budget.js';

const id = z.string().min(1).max(200).regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/);
const controls = readOptions.omit({ expected_generation: true });
export const candidateListInput = controls.extend({ repo_id: z.string().min(1).max(200).optional(), limit: z.number().int().min(1).max(50).default(12) }).strict();
export const candidateReadInput = controls.extend({ repo_id: z.string().min(1).max(200), id, byte_limit: z.number().int().min(1).max(32768).default(8192), expected_hash: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict();
export const candidateMetadata = z.object({ id, repo_id: z.string().min(1).max(100), title: z.string().min(1).max(160), summary: z.string().min(1).max(600), scope: contextOutput.shape.results.element.shape.scope, owner: z.string().min(1).max(200), state: z.literal('candidate'), content_hash: z.string().regex(/^[a-f0-9]{64}$/), utf8_bytes: z.number().int().min(1).max(65536) }).strict();
const page = { next_cursor: z.string().max(1024).nullable(), truncated: z.boolean(), estimated_tokens: z.number().int().nonnegative(), estimator_name: z.literal('utf8-bytes-divided-by-3-conservative') };
export const candidateListOutput = z.object({ candidates: z.array(candidateMetadata).max(50), snapshot: z.string().regex(/^[a-f0-9]{64}$/), ...page }).strict();
export const candidateReadOutput = z.object({ candidate: candidateMetadata, markdown: z.string().max(65536), body_offset: z.number().int().min(0).max(65536), ...page }).strict();
const errorData = z.object({ error: z.object({ code: z.string().min(1).max(100), message: z.string().max(300) }).strict() }).strict();
export const candidateListEnvelope = z.object({ ok: z.boolean(), data: z.union([candidateListOutput, errorData]) }).strict();
export const candidateReadEnvelope = z.object({ ok: z.boolean(), data: z.union([candidateReadOutput, errorData]) }).strict();

function parseInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new DomainError('VALIDATION_ERROR', 'Candidate inspection options are invalid.');
  return parsed.data;
}
function missing(): never { throw new DomainError('NOT_FOUND', 'Candidate or repository is unavailable.'); }
function unavailable(): never { throw new DomainError('CANDIDATE_STATE_UNAVAILABLE', 'Candidate state is unavailable or invalid; inspect storage before retrying.'); }
function authorized(paths: ResolvedPaths, repoId?: string): RegisteredRepo[] {
  const matches = paths.config.repositories.filter(repo => repoId === undefined || repo.id === repoId || repo.aliases.includes(repoId));
  if (repoId !== undefined && (matches.length !== 1 || matches[0]!.owner !== paths.config.principal)) missing();
  return matches.filter(repo => repo.owner === paths.config.principal).sort((a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
function visible(record: KnowledgeRecord, repo: RegisteredRepo): boolean {
  if (record.status !== 'candidate' || record.owner !== repo.owner) return false;
  const scope = record.scope;
  return scope.kind === 'shared' || (scope.kind === 'repo' && scope.repo_id === repo.id) || (scope.kind === 'team' && scope.team_id === repo.team) || (scope.kind === 'cross-repo' && scope.repo_ids.includes(repo.id));
}
function metadata(record: KnowledgeRecord, repo: RegisteredRepo, markdown: string) {
  return candidateMetadata.parse({ id: record.id, repo_id: repo.id, title: record.title, summary: record.summary, scope: record.scope, owner: record.owner, state: 'candidate', content_hash: snapshotText(markdown), utf8_bytes: Buffer.byteLength(markdown, 'utf8') });
}
// Hash raw UTF-8 bytes, matching submit/update expected_hash exactly.
function snapshotText(markdown: string) { return createHash('sha256').update(markdown).digest('hex'); }
type File = { repo: RegisteredRepo; filename: string; markdown: string };

/** Read-only filesystem inventory: deliberately never opens/reconciles the writer ledger. */
function inventory(paths: ResolvedPaths, repos: RegisteredRepo[]): File[] {
  const files: File[] = [];
  for (const repo of repos) {
    const directory = path.join(paths.knowledgeRoot, 'candidates', repo.id);
    safePath(directory, paths.knowledgeRoot);
    if (!existsSync(directory)) continue;
    const names = readdirSync(directory).filter(name => name.endsWith('.md')).sort();
    if (files.length + names.length > 1000) throw new DomainError('CONTEXT_BUDGET_EXCEEDED', 'Candidate scan limit reached; select a repository or reduce pending files.');
    for (const name of names) files.push({ repo, filename: path.join(directory, name), markdown: readCapture(path.join(directory, name), paths.knowledgeRoot) });
  }
  return files;
}
function fingerprint(files: File[]) { return snapshot(files.map(file => [file.repo.id, path.basename(file.filename), snapshotText(file.markdown)])); }
async function guarded<T>(action: () => Promise<T>): Promise<T> {
  try { return await action(); }
  catch (error) {
    if (error instanceof DomainError && ['VALIDATION_ERROR','NOT_FOUND','CONFLICT','CONTEXT_BUDGET_EXCEEDED'].includes(error.code)) throw error;
    return unavailable();
  }
}

export async function listCandidateSummaries(paths: ResolvedPaths, request: unknown = {}) {
  const input = parseInput(candidateListInput, request);
  const repos = authorized(paths, input.repo_id);
  return guarded(async () => {
    const files = inventory(paths, repos);
    const all: Array<z.infer<typeof candidateMetadata>> = [];
    for (const file of files) {
      const record = await parseKnowledgeMarkdown(file.markdown, paths.knowledgeRoot);
      if (record.id + '.md' !== path.basename(file.filename)) unavailable();
      if (visible(record, file.repo)) all.push(metadata(record, file.repo, file.markdown));
    }
    if (fingerprint(files) !== fingerprint(inventory(paths, repos))) throw new DomainError('CONFLICT', 'Candidate listing changed while reading; restart inspection.');
    const cap = limits(paths.config, input);
    const maximum = Math.min(input.limit, paths.config.budgets.maxResults);
    const key = snapshot(['candidate-list-v1', paths.knowledgeRoot, paths.config.principal, repos.map(repo => [repo.id,repo.owner,repo.team]), maximum, cap, all.map(item => [item.repo_id,item.id,item.content_hash])]);
    const start = offsetFor(input.cursor, key, all.length);
    const candidates = all.slice(start, start + maximum);
    const make = () => measured({ candidates, snapshot: key, next_cursor: start + candidates.length < all.length ? continuation(key, start + candidates.length) : null, truncated: start + candidates.length < all.length });
    while (!fits(make(), cap)) { if (candidates.length <= 1) budgetError(); candidates.pop(); }
    return candidateListOutput.parse(make());
  });
}

export async function readCandidate(paths: ResolvedPaths, request: unknown) {
  const input = parseInput(candidateReadInput, request);
  const repo = authorized(paths, input.repo_id)[0]!;
  return guarded(async () => {
    const filename = path.join(paths.knowledgeRoot, 'candidates', repo.id, input.id + '.md');
    safePath(filename, paths.knowledgeRoot);
    if (!existsSync(filename)) missing();
    const markdown = readCapture(filename, paths.knowledgeRoot);
    const record = await parseKnowledgeMarkdown(markdown, paths.knowledgeRoot);
    if (record.id !== input.id || !visible(record, repo)) missing();
    const candidate = metadata(record, repo, markdown);
    if (readCapture(filename, paths.knowledgeRoot) !== markdown) throw new DomainError('CONFLICT', 'Candidate changed while reading; inspect it again.');
    if (input.expected_hash && input.expected_hash !== candidate.content_hash) throw new DomainError('CONFLICT', 'Candidate changed since inspection; inspect it again.');
    const bytes = Buffer.from(markdown, 'utf8'), cap = limits(paths.config, input);
    const key = snapshot(['candidate-body-v1',paths.knowledgeRoot,paths.config.principal,repo.id,candidate.content_hash,input.byte_limit,cap]);
    const start = offsetFor(input.cursor,key,bytes.length);
    if (start > 0 && (bytes[start]! & 0xc0) === 0x80) throw new DomainError('VALIDATION_ERROR','Candidate continuation is not a UTF-8 boundary.');
    const make = (end: number) => measured({ candidate, markdown: bytes.subarray(start,end).toString('utf8'), body_offset:start, next_cursor:end<bytes.length?continuation(key,end):null, truncated:end<bytes.length });
    let low = start, high = Math.min(bytes.length,start+input.byte_limit);
    if (high === bytes.length && fits(make(high),cap)) return candidateReadOutput.parse(make(high));
    while (low < high) { const middle = Math.ceil((low+high)/2); if (fits(make(utf8End(bytes,middle)),cap)) low=middle; else high=middle-1; }
    const end = utf8End(bytes,low), result = make(end);
    if (end === start || !fits(result,cap)) budgetError();
    return candidateReadOutput.parse(result);
  });
}
