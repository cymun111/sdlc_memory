import { existsSync, readdirSync, readFileSync, realpathSync, lstatSync } from 'node:fs';
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
      if (!existsSync(directory)) continue;
      if (realpathSync(directory) !== directory || !lstatSync(directory).isDirectory()) throw new Error('Invalid directory');
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (!entry.name.endsWith('.json')) continue;
        if (!entry.isFile() || entry.isSymbolicLink()) throw new Error('Invalid report file');
        const filename = path.join(directory, entry.name);
        if (lstatSync(filename).size > 65536) throw new Error('Report exceeds limit');
        const report = conflictReportSchema.parse(JSON.parse(readFileSync(filename, 'utf8')));
        if (entry.name !== report.id + '.json' || (report.repo_id !== undefined && report.repo_id !== repo.id)) throw new Error('Identity mismatch');
        if (report.state === 'candidate' && report.record_ids.every((id) => readableIds.has(id))) refs.push(conflictReferenceSchema.parse({ id: report.id, record_ids: [...report.record_ids].sort(), source: 'report' }));
      }
    }
  } catch { throw new DomainError('CONFLICT_STATE_UNAVAILABLE', 'Authorized conflict state is unavailable or invalid; inspect it before continuing.'); }
  return refs.sort((a, b) => a.id.localeCompare(b.id));
}
