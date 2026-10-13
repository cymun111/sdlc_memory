import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { DomainError } from '../capture/candidate-store.js';

const sha = z.string().regex(/^[a-f0-9]{40,64}$/);
const fingerprint = z.string().regex(/^[a-f0-9]{64}$/);
export const knowledgeSnapshotSchema = z.object({
  manifest_version: z.literal(2), schema_version: z.literal(1), indexer_version: z.literal('knowledge-2'),
  generation: z.uuid(), built_at: z.iso.datetime(), record_count: z.number().int().nonnegative(),
  knowledge_commit: sha.nullable(), source_state: z.enum(['clean', 'dirty', 'unversioned', 'git_unavailable']),
  content_fingerprint: fingerprint, schema_fingerprint: fingerprint
}).strict().refine((value) => (value.source_state === 'clean' || value.source_state === 'dirty') === (value.knowledge_commit !== null), 'Commit/state mismatch');
export const checkoutDriftSchema = z.object({ state: z.enum(['matched', 'changed', 'unavailable']), head_revision: sha.nullable(), head_changed: z.boolean().nullable(), content_changed: z.boolean().nullable() }).strict();
export const applicationSourceSchema = z.object({ repo_id: z.string().min(1).max(200), requested_revision: sha.nullable() }).strict().nullable();
export type KnowledgeSnapshot = z.infer<typeof knowledgeSnapshotSchema>;
// Counts are persisted for integrity checks, not disclosed across access scopes.
export const publicKnowledgeSnapshotSchema = z.object(knowledgeSnapshotSchema.shape).omit({ record_count: true });
export type KnowledgeSnapshotMetadata = z.infer<typeof publicKnowledgeSnapshotSchema>;
export type CheckoutDrift = z.infer<typeof checkoutDriftSchema>;
export const normalizeBody = (value: string) => value.replace(/\r\n/g, '\n');
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
type FileInput = { file: string; body: string };
export interface BuildInputs { files: FileInput[]; contentFingerprint: string; schemaFingerprint: string; git: { commit: string | null; state: KnowledgeSnapshot['source_state'] } }
const contentHash = (files: FileInput[]) => hash(JSON.stringify(files.map(({ file, body }) => [file, hash(normalizeBody(body))]).sort((a, b) => a[0]! < b[0]! ? -1 : a[0]! > b[0]! ? 1 : 0)));
function git(root: string, args: string[]) { return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', timeout: 5000, maxBuffer: 4 * 1024 * 1024, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
function gitState(root: string): BuildInputs['git'] {
  // Do not attribute a nested/unversioned folder to an unrelated ancestor checkout.
  if (!existsSync(path.join(root, '.git'))) return { commit: null, state: 'unversioned' };
  try {
    const commit = sha.parse(git(root, ['rev-parse', 'HEAD']));
    const dirty = git(root, ['status', '--porcelain', '--untracked-files=all', '--', 'knowledge', 'schemas/knowledge.schema.json']);
    return { commit, state: dirty ? 'dirty' : 'clean' };
  } catch { return { commit: null, state: 'git_unavailable' }; }
}
async function filesUnder(directory: string, prefix = 'knowledge'): Promise<string[]> {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch { throw new DomainError('INDEX_SOURCE_UNAVAILABLE', 'A required knowledge directory is unavailable.'); }
  const nested = await Promise.all(entries.map(async (entry) => {
    if (entry.isSymbolicLink()) throw new DomainError('INDEX_SOURCE_UNAVAILABLE', 'Knowledge source links are not supported.');
    const relative = prefix + '/' + entry.name;
    if (entry.isDirectory()) return filesUnder(path.join(directory, entry.name), relative);
    return entry.isFile() && entry.name.endsWith('.md') ? [relative] : [];
  }));
  return nested.flat().sort();
}
export async function captureBuildInputs(root: string): Promise<BuildInputs> {
  const state = gitState(root);
  const names = await filesUnder(path.join(root, 'knowledge'));
  let files: FileInput[];
  let schema: string;
  try {
    files = await Promise.all(names.map(async (file) => ({ file, body: normalizeBody(await readFile(path.join(root, file), 'utf8')) })));
    try { schema = normalizeBody(await readFile(path.join(root, 'schemas/knowledge.schema.json'), 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; schema = 'schema-unavailable'; }
  } catch { throw new DomainError('INDEX_SOURCE_UNAVAILABLE', 'A required knowledge record or schema is unavailable.'); }
  // Confirm clean attribution from actual Git objects, including ignored/untracked records.
  if (state.state === 'clean') {
    try {
      const tracked = git(root, ['ls-tree', '-r', '--name-only', state.commit!, '--', 'knowledge']).split('\n').filter((file) => file.endsWith('.md')).sort();
      if (JSON.stringify(tracked) !== JSON.stringify(names)) state.state = 'dirty';
      for (const input of files) if (normalizeBody(execFileSync('git', ['-C', root, 'show', `${state.commit}:${input.file}`], { encoding: 'utf8', timeout: 5000, maxBuffer: 4 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })) !== input.body) state.state = 'dirty';
      if (schema !== 'schema-unavailable' && normalizeBody(execFileSync('git', ['-C', root, 'show', `${state.commit}:schemas/knowledge.schema.json`], { encoding: 'utf8', timeout: 5000, maxBuffer: 4 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })) !== schema) state.state = 'dirty';
    } catch { state.state = 'dirty'; }
  }
  return { files, contentFingerprint: contentHash(files), schemaFingerprint: hash(schema), git: state };
}
export async function assertBuildInputsUnchanged(root: string, original: BuildInputs): Promise<void> {
  try {
    const current = await captureBuildInputs(root);
    if (original.contentFingerprint !== current.contentFingerprint || original.schemaFingerprint !== current.schemaFingerprint || JSON.stringify(original.git) !== JSON.stringify(current.git)) throw new Error('Changed input');
  } catch { throw new DomainError('INDEX_SOURCE_CHANGED', 'Knowledge inputs changed during indexing; retry the full rebuild.'); }
}
export function readSnapshot(database: DatabaseSync): KnowledgeSnapshot {
  const columns = database.prepare('PRAGMA table_info(index_manifest)').all();
  if (!columns.some((column) => column.name === 'snapshot_json')) throw new DomainError('INDEX_REBUILD_REQUIRED', 'This index predates snapshot provenance; rebuild with knowledge index --full.');
  const row = database.prepare('SELECT * FROM index_manifest WHERE singleton = 1').get();
  if (!row?.snapshot_json) throw new DomainError('INDEX_REBUILD_REQUIRED', 'This index lacks snapshot provenance; rebuild with knowledge index --full.');
  try {
    const snapshot = knowledgeSnapshotSchema.parse(JSON.parse(String(row.snapshot_json)));
    if (snapshot.generation !== row.generation || snapshot.record_count !== row.record_count || snapshot.built_at !== row.built_at || snapshot.knowledge_commit !== row.knowledge_commit) throw new Error('Manifest mismatch');
    return snapshot;
  } catch { throw new DomainError('INDEX_UNAVAILABLE', 'The indexed snapshot manifest is invalid; rebuild with knowledge index --full.'); }
}
export function snapshotRevision(snapshot: KnowledgeSnapshot): string {
  return snapshot.source_state === 'clean' ? snapshot.knowledge_commit! : `${snapshot.source_state}:${snapshot.content_fingerprint}`;
}
export function checkoutDrift(root: string, snapshot: KnowledgeSnapshotMetadata): CheckoutDrift {
  try {
    const files: FileInput[] = [];
    const walk = (directory: string, prefix = 'knowledge') => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (entry.isSymbolicLink()) throw new Error('Source link');
        const relative = prefix + '/' + entry.name;
        if (entry.isDirectory()) walk(path.join(directory, entry.name), relative);
        else if (entry.isFile() && entry.name.endsWith('.md')) files.push({ file: relative, body: readFileSync(path.join(directory, entry.name), 'utf8') });
      }
    };
    walk(path.join(root, 'knowledge'));
    let schema: string;
    try { schema = normalizeBody(readFileSync(path.join(root, 'schemas/knowledge.schema.json'), 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; schema = 'schema-unavailable'; }
    const state = gitState(root);
    const content_changed = contentHash(files) !== snapshot.content_fingerprint || hash(schema) !== snapshot.schema_fingerprint;
    const head_changed = state.state === 'git_unavailable' ? null : state.commit !== snapshot.knowledge_commit;
    return checkoutDriftSchema.parse({ state: state.state === 'git_unavailable' ? 'unavailable' : content_changed || head_changed ? 'changed' : 'matched', head_revision: state.commit, head_changed, content_changed });
  } catch { return { state: 'unavailable', head_revision: null, head_changed: null, content_changed: null }; }
}
export function provenance(database: DatabaseSync, root: string) {
  const stored = readSnapshot(database);
  const { record_count: _count, ...knowledge_snapshot } = stored;
  return { knowledge_revision: snapshotRevision(stored), index_generation: knowledge_snapshot.generation, knowledge_snapshot, checkout_drift: checkoutDrift(root, knowledge_snapshot) };
}
export async function optionalProvenance(root: string, runtimeRoot: string) {
  try { await readFile(path.join(runtimeRoot, 'index-active.json'), 'utf8'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { knowledge_revision: null, index_generation: null, knowledge_snapshot: null, checkout_drift: null };
    throw new DomainError('INDEX_UNAVAILABLE', 'The active index is unavailable.');
  }
  const { openIndex } = await import('./database.js');
  const database = await openIndex(runtimeRoot);
  try { return provenance(database, root); } finally { database.close(); }
}
