import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { stringify } from 'yaml';
import type { ResolvedPaths } from '../core/config.js';
import type { KnowledgeRecord } from '../core/types.js';
import { buildActiveGeneration } from '../indexing/build-index.js';
import { parseKnowledgeMarkdown } from '../validation/record.js';
import { listCandidates, markCandidateState, persistConflictReport, DomainError } from './candidate-store.js';

function git(repoPath: string, args: string[]): string {
  return execFileSync('git', ['-C', repoPath, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

function sha256(content: string): string { return createHash('sha256').update(content).digest('hex'); }

function frontMatterEnd(markdown: string): number {
  const index = markdown.replace(/\r\n/g, '\n').indexOf('\n---', 4);
  if (index < 0) throw new DomainError('VALIDATION_ERROR', 'Candidate has malformed front matter');
  return index + 4;
}

function safePublishedPath(paths: ResolvedPaths, record: KnowledgeRecord): string {
  const base = record.scope.kind === 'repo'
    ? path.join(paths.knowledgeRoot, 'knowledge', 'repos', record.scope.repo_id, 'learnings')
    : record.scope.kind === 'team'
      ? path.join(paths.knowledgeRoot, 'knowledge', 'teams', record.scope.team_id, 'practices')
      : record.scope.kind === 'shared'
        ? path.join(paths.knowledgeRoot, 'knowledge', 'shared', record.type === 'decision' ? 'decisions' : 'standards')
        : path.join(paths.knowledgeRoot, 'knowledge', 'cross-repo', 'integrations');
  const filename = record.type === 'overview' && record.scope.kind === 'repo' ? 'overview.md' : `${record.id.replaceAll('.', '-')}.md`;
  const destination = path.resolve(base, filename);
  const knowledge = path.resolve(paths.knowledgeRoot, 'knowledge');
  if (!destination.startsWith(`${knowledge}${path.sep}`)) throw new DomainError('FORBIDDEN', 'Published path escapes knowledge root');
  return destination;
}

function findMarkdown(directory: string): string[] {
  if (!existsSync(directory)) return [];
  const output: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...findMarkdown(file));
    else if (entry.isFile() && entry.name.endsWith('.md')) output.push(file);
  }
  return output;
}

function verifyEvidence(paths: ResolvedPaths, record: KnowledgeRecord): void {
  if (!record.sources.length) throw new DomainError('SOURCE_UNAVAILABLE', 'Publishing requires evidence sources');
  if (record.type === 'observed-behavior' && !record.sources.some((source) => source.kind === 'code')) {
    throw new DomainError('SOURCE_UNAVAILABLE', 'Observed behavior requires local code evidence');
  }
  if (['approved-policy', 'decision'].includes(record.type) && !record.sources.some((source) => source.kind === 'decision')) {
    throw new DomainError('SOURCE_UNAVAILABLE', 'Policies and decisions require explicit decision approval evidence');
  }
  for (const source of record.sources) {
    if (source.kind !== 'code') continue;
    const repoId = String(source.repo_id ?? '');
    const repository = paths.config.repositories.find((repo) => repo.id === repoId);
    if (!repository) throw new DomainError('SOURCE_UNAVAILABLE', `Evidence repository is not registered: ${repoId}`);
    const commit = String(source.commit ?? '');
    const relativePath = String(source.path ?? '').replaceAll('\\', '/');
    if (!/^[0-9a-f]{40}$/i.test(commit) || relativePath.startsWith('/') || relativePath.split('/').includes('..')) {
      throw new DomainError('VALIDATION_ERROR', 'Code evidence must use a full commit SHA and a repository-relative safe path');
    }
    try { git(repository.path, ['cat-file', '-e', `${commit}:${relativePath}`]); }
    catch { throw new DomainError('SOURCE_UNAVAILABLE', `Evidence path does not exist at cited commit: ${repoId}:${relativePath}`); }
    try {
      const citedBlob = git(repository.path, ['rev-parse', `${commit}:${relativePath}`]);
      const currentBlob = git(repository.path, ['hash-object', '--', relativePath]);
      if (citedBlob !== currentBlob) throw new DomainError('SOURCE_UNAVAILABLE', `Evidence source is dirty or changed since the cited commit: ${relativePath}`);
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw new DomainError('SOURCE_UNAVAILABLE', `Cannot verify source evidence: ${relativePath}`);
    }
  }
}

function archiveCandidate(paths: ResolvedPaths, candidatePath: string, id: string): string {
  const archiveRoot = path.join(paths.runtimeRoot, 'archive', 'candidates');
  mkdirSync(archiveRoot, { recursive: true });
  const destination = path.join(archiveRoot, `${id}-${randomUUID()}.md`);
  renameSync(candidatePath, destination);
  return destination;
}

export async function inspectCandidate(paths: ResolvedPaths, id: string, repoId?: string) {
  const candidate = (await listCandidates(paths, repoId)).find((item) => item.id === id);
  if (!candidate) throw new DomainError('NOT_FOUND', `Pending candidate not found: ${id}`);
  const markdown = readFileSync(candidate.path, 'utf8');
  return { ...candidate, markdown };
}

export async function approveCandidate(paths: ResolvedPaths, input: { id: string; expectedHash: string }): Promise<{ id: string; state: string; path: string; index_generation?: string; index_refresh_error?: string; worktree_state: string }> {
  const candidate = await inspectCandidate(paths, input.id);
  if (candidate.hash !== input.expectedHash) throw new DomainError('CONFLICT', 'Candidate changed since inspection; inspect it again and use the current content hash');
  const repository = paths.config.repositories.find((repo) => repo.id === candidate.repo_id);
  if (!repository) throw new DomainError('NOT_FOUND', `Repository is not registered: ${candidate.repo_id}`);
  if (repository.owner !== paths.config.owner) throw new DomainError('FORBIDDEN', `Local owner ${paths.config.owner} cannot publish for owner ${repository.owner}`);
  const record = await parseKnowledgeMarkdown(candidate.markdown, paths.knowledgeRoot);
  if (record.status !== 'candidate') throw new DomainError('CONFLICT', 'Only pending candidate records can be approved');
  verifyEvidence(paths, record);
  const existing = await Promise.all(findMarkdown(path.join(paths.knowledgeRoot, 'knowledge')).map(async (file) => ({ file, record: await parseKnowledgeMarkdown(readFileSync(file, 'utf8'), paths.knowledgeRoot) })));
  const duplicate = existing.find((item) => item.record.id === record.id);
  if (duplicate) throw new DomainError('CONFLICT', `A published record already uses ID ${record.id}: ${duplicate.file}`);
  const separator = frontMatterEnd(candidate.markdown);
  const body = candidate.markdown.replace(/\r\n/g, '\n').slice(separator);
  const verified: KnowledgeRecord = { ...record, status: 'verified', updated_at: new Date().toISOString() };
  const published = `---\n${stringify(verified).trimEnd()}\n---${body}`;
  const destination = safePublishedPath(paths, verified);
  if (existsSync(destination)) throw new DomainError('CONFLICT', `Publication destination already exists: ${destination}`);
  mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${randomUUID()}.tmp`;
  writeFileSync(temporary, published, { flag: 'wx', mode: 0o600 });
  renameSync(temporary, destination);
  const archivePath = archiveCandidate(paths, candidate.path, record.id);
  markCandidateState(paths, record.id, 'published', archivePath);
  let generation: string | undefined;
  let refreshError: string | undefined;
  try { generation = (await buildActiveGeneration(paths.knowledgeRoot, paths.runtimeRoot)).generation; }
  catch (error) { refreshError = error instanceof Error ? error.message : String(error); }
  const gitState = (() => {
    try { return git(paths.knowledgeRoot, ['status', '--porcelain', '--', 'knowledge', 'candidates']); }
    catch { return 'unversioned'; }
  })();
  return { id: record.id, state: refreshError ? 'published_index_refresh_failed' : 'published', path: destination, ...(generation ? { index_generation: generation } : {}), ...(refreshError ? { index_refresh_error: refreshError } : {}), worktree_state: gitState ? 'dirty' : 'clean' };
}

export async function rejectCandidate(paths: ResolvedPaths, input: { id: string; reason: string; expectedHash?: string }): Promise<{ id: string; state: 'rejected'; archive_path: string }> {
  if (!input.reason.trim()) throw new DomainError('VALIDATION_ERROR', 'Rejection requires a reason');
  const candidate = await inspectCandidate(paths, input.id);
  if (input.expectedHash && input.expectedHash !== candidate.hash) throw new DomainError('CONFLICT', 'Candidate changed since inspection');
  const archivePath = archiveCandidate(paths, candidate.path, candidate.id);
  markCandidateState(paths, candidate.id, 'rejected', archivePath, input.reason);
  return { id: candidate.id, state: 'rejected', archive_path: archivePath };
}

export function createConflictReport(paths: ResolvedPaths, input: { repoId: string; recordIds: string[]; explanation: string; evidence?: Array<Record<string, unknown>> }): { id: string; receipt_id: string; path: string; state: 'candidate' } {
  if (input.recordIds.length < 2 || !input.explanation.trim()) throw new DomainError('VALIDATION_ERROR', 'Conflict report requires at least two record IDs and an explanation');
  const id = randomUUID();
  const receiptId = randomUUID();
  const directory = path.join(paths.knowledgeRoot, 'candidates', input.repoId, 'conflicts');
  mkdirSync(directory, { recursive: true });
  const filename = path.join(directory, `${id}.json`);
  const data = { id, receipt_id: receiptId, record_ids: input.recordIds, explanation: input.explanation, evidence: input.evidence ?? [], submitter: paths.config.principal, state: 'candidate', created_at: new Date().toISOString() };
  writeFileSync(filename, `${JSON.stringify(data, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  persistConflictReport(paths, { id, receipt_id: receiptId, record_ids: input.recordIds, explanation: input.explanation, evidence: input.evidence ?? [] });
  return { id, receipt_id: receiptId, path: filename, state: 'candidate' };
}
