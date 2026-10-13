import { existsSync, readdirSync, readFileSync, realpathSync, lstatSync, openSync, closeSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import type { ResolvedPaths } from '../core/config.js';
import { DomainError } from './candidate-store.js';

export const conflictReportSchema = z.object({
  schema_version: z.literal(1).default(1), id: z.uuid(), receipt_id: z.uuid(), repo_id: z.string().optional(),
  record_ids: z.array(z.string().regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/)).min(2).max(20).refine((ids) => new Set(ids).size === ids.length),
  explanation: z.string().min(1).max(4000), evidence: z.array(z.record(z.string(), z.unknown())).max(100),
  submitter: z.string().min(1).max(200), state: z.enum(['candidate', 'resolved', 'rejected']), created_at: z.iso.datetime(),
  resolution: z.object({ approver: z.string().min(1).max(200), approved_at: z.iso.datetime(), reason: z.string().min(1).max(4000) }).strict().optional()
}).strict().refine((report) => report.state === 'candidate' ? report.resolution === undefined : report.resolution !== undefined, 'Resolution evidence required');
export const conflictReferenceSchema = z.object({ id: z.string().min(1).max(200), record_ids: z.array(z.string().min(1).max(200)).min(2).max(20), source: z.enum(['report', 'relationship']) }).strict();
export type ConflictReference = z.infer<typeof conflictReferenceSchema>;

/** Optional candidate directories; required readable/valid contents when present. Never opens a writer ledger. */
export function readConflictReferences(paths: ResolvedPaths, readableIds: Set<string>): ConflictReference[] {
  const refs: ConflictReference[] = [];
  try {
    for (const repo of paths.config.repositories) {
      const directory = path.join(paths.knowledgeRoot, 'candidates', repo.id, 'conflicts');
      let canonical: string;
      try { canonical = realpathSync(directory); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
      if (canonical !== directory || !lstatSync(directory).isDirectory()) throw new Error('Invalid directory');
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (!entry.name.endsWith('.json')) continue;
        if (!entry.isFile() || entry.isSymbolicLink()) throw new Error('Invalid report file');
        const filename = path.join(directory, entry.name);
        if (lstatSync(filename).size > 65536) throw new Error('Report exceeds limit');
        const report = conflictReportSchema.parse(JSON.parse(readFileSync(filename, 'utf8')));
        if (entry.name !== report.id + '.json' || (report.repo_id !== undefined && report.repo_id !== repo.id)) throw new Error('Identity mismatch');
        if (report.resolution && report.resolution.approver !== repo.owner) throw new Error('Invalid owner evidence');
        if (report.state === 'candidate' && report.record_ids.every((id) => readableIds.has(id))) refs.push(conflictReferenceSchema.parse({ id: report.id, record_ids: [...report.record_ids].sort(), source: 'report' }));
      }
    }
  } catch { throw new DomainError('CONFLICT_STATE_UNAVAILABLE', 'Authorized conflict state is unavailable or invalid; inspect it before continuing.'); }
  return refs.sort((a, b) => a.id.localeCompare(b.id));
}

function ownerRepository(paths: ResolvedPaths, repoId: string) {
  const matches = paths.config.repositories.filter((repo) => repo.id === repoId || repo.aliases.includes(repoId));
  if (matches.length !== 1) throw new DomainError('NOT_FOUND', 'Repository is not registered unambiguously.');
  const repo = matches[0]!;
  if (paths.config.principal !== repo.owner || paths.config.owner !== repo.owner) throw new DomainError('FORBIDDEN', 'Only the configured repository owner may review conflict reports.');
  return repo;
}
function loadReport(paths: ResolvedPaths, repoId: string, id: string) {
  if (!z.uuid().safeParse(id).success) throw new DomainError('VALIDATION_ERROR', 'Invalid conflict report ID.');
  const filename = path.join(paths.knowledgeRoot, 'candidates', repoId, 'conflicts', id + '.json');
  if (!existsSync(filename)) throw new DomainError('NOT_FOUND', 'Conflict report not found.');
  try {
    if (realpathSync(filename) !== filename || !lstatSync(filename).isFile() || lstatSync(filename).size > 65536) throw new Error('Invalid file');
    const body = readFileSync(filename, 'utf8'); const report = conflictReportSchema.parse(JSON.parse(body));
    if (report.id !== id || (report.repo_id !== undefined && report.repo_id !== repoId)) throw new Error('Wrong identity');
    return { filename, report, hash: createHash('sha256').update(body).digest('hex') };
  } catch { throw new DomainError('CONFLICT_STATE_UNAVAILABLE', 'Conflict report is unavailable or invalid.'); }
}
export async function inspectConflictReport(paths: ResolvedPaths, repoId: string, id: string) {
  const repo = ownerRepository(paths, repoId); const loaded = loadReport(paths, repo.id, id);
  const { KnowledgeService } = await import('../retrieval/service.js');
  const service = new KnowledgeService(paths);
  // Explicit owner review uses the trusted principal's full allowlist, not a task applicability filter.
  for (const recordId of loaded.report.record_ids) await service.get(recordId, undefined, 1, true);
  return { repo_id: repo.id, hash: loaded.hash, report: loaded.report };
}
const resolutionInput = z.object({ repoId: z.string().min(1).max(200), id: z.uuid(), expectedHash: z.string().regex(/^[a-f0-9]{64}$/), state: z.enum(['resolved', 'rejected']), reason: z.string().trim().min(1).max(4000) }).strict();
export async function resolveConflictReport(paths: ResolvedPaths, request: unknown) {
  const parsed = resolutionInput.safeParse(request);
  if (!parsed.success) throw new DomainError('VALIDATION_ERROR', 'The conflict review request is invalid.');
  const input = parsed.data; const inspected = await inspectConflictReport(paths, input.repoId, input.id);
  const currentOwner = ownerRepository(paths, input.repoId);
  if (currentOwner.id !== inspected.repo_id) throw new DomainError('CONFLICT', 'Repository identity changed during review.');
  const filename = path.join(paths.knowledgeRoot, 'candidates', inspected.repo_id, 'conflicts', input.id + '.json');
  const lock = filename + '.lock'; const temporary = filename + '.' + randomUUID() + '.tmp';
  let descriptor: number;
  try { descriptor = openSync(lock, 'wx', 0o600); }
  catch { throw new DomainError('CONFLICT', 'Conflict review is locked; inspect ongoing or interrupted review before retrying.'); }
  try {
    const current = loadReport(paths, inspected.repo_id, input.id);
    if (current.hash !== input.expectedHash || current.report.state !== 'candidate') throw new DomainError('CONFLICT', 'Conflict report changed; inspect it again.');
    const report = conflictReportSchema.parse({ ...current.report, repo_id: inspected.repo_id, state: input.state, resolution: { approver: paths.config.principal, approved_at: new Date().toISOString(), reason: input.reason } });
    const body = JSON.stringify(report, null, 2) + '\n';
    if (Buffer.byteLength(body, 'utf8') > 65536) throw new DomainError('VALIDATION_ERROR', 'Reviewed report exceeds the byte limit.');
    writeFileSync(temporary, body, { flag: 'wx', mode: 0o600, flush: true }); renameSync(temporary, filename);
    return { id: report.id, repo_id: inspected.repo_id, state: report.state, content_hash: createHash('sha256').update(body).digest('hex') };
  } finally { closeSync(descriptor); rmSync(lock, { force: true }); rmSync(temporary, { force: true }); }
}
