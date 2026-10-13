import { createHash } from 'node:crypto';
import { mkdir, rename, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { parseKnowledgeMarkdown } from '../validation/record.js';
import { openIndex } from './database.js';
import { DomainError } from '../capture/candidate-store.js';
import { validateRecordGraph } from '../validation/graph.js';
import { z } from 'zod';
import { captureBuildInputs, assertBuildInputsUnchanged, knowledgeSnapshotSchema, type BuildInputs } from './provenance.js';

export const indexBuildStatusSchema = z.discriminatedUnion('state', [
  z.object({ schema_version: z.literal(1), attempted_generation: z.uuid(), occurred_at: z.iso.datetime(), state: z.literal('ready'), active_generation: z.uuid() }).strict(),
  z.object({ schema_version: z.literal(1), attempted_generation: z.uuid(), occurred_at: z.iso.datetime(), state: z.literal('degraded'), error: z.object({ code: z.enum(['INDEX_SOURCE_UNAVAILABLE', 'INDEX_SOURCE_CHANGED', 'INDEX_VALIDATION_FAILED', 'INDEX_BUILD_FAILED']), message: z.string().max(300) }).strict() }).strict()
]);

export async function buildFixtureIndex(database: DatabaseSync, root: string, inputs?: BuildInputs, generation = randomUUID()): Promise<number> {
  const captured = inputs ?? await captureBuildInputs(root);
  const records = await Promise.all(captured.files.map(async ({ body }) => {
    try { return { record: await parseKnowledgeMarkdown(body, root, captured.schemaSource), body }; }
    catch { throw new DomainError('INDEX_VALIDATION_FAILED', 'A knowledge record failed validation.'); }
  }));
  validateRecordGraph(records.map(({ record }) => record));
  database.exec('BEGIN IMMEDIATE');
  try {
    database.exec('DELETE FROM record_search; DELETE FROM edges; DELETE FROM records;');
    const insertRecord = database.prepare(`INSERT INTO records
      (id, title, summary, type, scope_kind, scope_json, status, body, content_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const insertSearch = database.prepare('INSERT INTO record_search (id, title, summary, body) VALUES (?, ?, ?, ?)');
    const insertEdge = database.prepare('INSERT INTO edges (source_id, relation, target_id) VALUES (?, ?, ?)');
    for (const { record, body } of records) {
      const hash = createHash('sha256').update(body).digest('hex');
      insertRecord.run(record.id, record.title, record.summary, record.type, record.scope.kind, JSON.stringify(record.scope), record.status, body, hash);
      insertSearch.run(record.id, record.title, record.summary, body.slice(body.indexOf('\n---', 4) + 4));
      for (const edge of record.relationships) insertEdge.run(record.id, edge.type, edge.target);
    }
    const snapshot = knowledgeSnapshotSchema.parse({ manifest_version: 2, schema_version: 1, indexer_version: 'knowledge-2', generation, built_at: new Date().toISOString(), record_count: records.length, knowledge_commit: captured.git.commit, source_state: captured.git.state, content_fingerprint: captured.contentFingerprint, schema_fingerprint: captured.schemaFingerprint });
    database.prepare(`INSERT OR REPLACE INTO index_manifest (singleton, generation, built_at, record_count, knowledge_commit, snapshot_json)
      VALUES (1, ?, ?, ?, ?, ?)`).run(generation, snapshot.built_at, records.length, snapshot.knowledge_commit, JSON.stringify(snapshot));
    await assertBuildInputsUnchanged(root, captured);
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
  return records.length;
}

export async function buildActiveGeneration(root: string, runtimeRoot: string): Promise<{ generation: string; recordCount: number }> {
  const generationsRoot = path.join(runtimeRoot, 'index-generations');
  const generation = randomUUID();
  const temporaryDatabase = path.join(generationsRoot, `${generation}.staging.sqlite`);
  const finalDatabase = path.join(generationsRoot, `${generation}.sqlite`);
  const activePath = path.join(runtimeRoot, 'index-active.json');
  const activeTemporary = `${activePath}.${generation}.tmp`;
  const statusPath = path.join(runtimeRoot, 'index-build-status.json');
  const statusTemporary = `${statusPath}.${generation}.tmp`;
  let database: DatabaseSync | undefined;
  let switched = false;
  const status = async (value: object) => {
    const checked = indexBuildStatusSchema.parse({ schema_version: 1, attempted_generation: generation, occurred_at: new Date().toISOString(), ...value });
    await writeFile(statusTemporary, JSON.stringify(checked) + '\n', { flag: 'wx' });
    await rename(statusTemporary, statusPath);
  };
  try {
    await mkdir(generationsRoot, { recursive: true });
    database = await openIndex(runtimeRoot, temporaryDatabase);
    const inputs = await captureBuildInputs(root);
    const recordCount = await buildFixtureIndex(database, root, inputs, generation);
    if (database.prepare('PRAGMA quick_check').get()?.quick_check !== 'ok') throw new Error('Integrity check failed');
    database.close(); database = undefined;
    await rename(temporaryDatabase, finalDatabase);
    await writeFile(activeTemporary, `${JSON.stringify({ generation, database: path.relative(runtimeRoot, finalDatabase), recordCount, switchedAt: new Date().toISOString() }, null, 2)}\n`, { flag: 'wx' });
    await assertBuildInputsUnchanged(root, inputs);
    await rename(activeTemporary, activePath);
    switched = true;
    // Status is diagnostic. Failure to write it cannot invalidate a successfully switched index.
    await status({ state: 'ready', active_generation: generation }).catch(() => undefined);
    return { generation, recordCount };
  } catch (error) {
    const failure = error instanceof DomainError ? error : new DomainError('INDEX_BUILD_FAILED', 'Index rebuild failed; the previous active generation was preserved.');
    await status({ state: 'degraded', error: { code: failure.code, message: failure.message } }).catch(() => undefined);
    throw failure;
  } finally {
    database?.close();
    const artifacts = [temporaryDatabase, `${temporaryDatabase}-wal`, `${temporaryDatabase}-shm`, activeTemporary, statusTemporary];
    if (!switched) artifacts.push(finalDatabase, `${finalDatabase}-wal`, `${finalDatabase}-shm`);
    await Promise.all(artifacts.map((file) => rm(file, { force: true }).catch(() => undefined)));
  }
}
