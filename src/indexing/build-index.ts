import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { parseKnowledgeMarkdown } from '../validation/record.js';
import { openIndex } from './database.js';

async function findRecords(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const results = await Promise.all(entries.map(async (entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) return [];
    if (entry.isDirectory()) return findRecords(file);
    return entry.isFile() && entry.name.endsWith('.md') ? [file] : [];
  }));
  return results.flat();
}

export async function buildFixtureIndex(database: DatabaseSync, root: string): Promise<number> {
  const files = await findRecords(path.join(root, 'knowledge'));
  const records = await Promise.all(files.map(async (file) => {
    const body = await readFile(file, 'utf8');
    return { record: await parseKnowledgeMarkdown(body, root), body };
  }));
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
    database.prepare(`INSERT OR REPLACE INTO index_manifest (singleton, generation, built_at, record_count)
      VALUES (1, ?, ?, ?)`).run(createHash('sha256').update(records.map(({ record }) => record.id).sort().join('\n')).digest('hex').slice(0, 16), new Date().toISOString(), records.length);
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
  return records.length;
}

export async function buildActiveGeneration(root: string, runtimeRoot: string): Promise<{ generation: string; recordCount: number }> {
  const generationsRoot = path.join(runtimeRoot, 'index-generations');
  await mkdir(generationsRoot, { recursive: true });
  const generation = randomUUID();
  const temporaryDatabase = path.join(generationsRoot, `${generation}.staging.sqlite`);
  const finalDatabase = path.join(generationsRoot, `${generation}.sqlite`);
  const database = await openIndex(runtimeRoot, temporaryDatabase);
  let recordCount: number;
  try {
    recordCount = await buildFixtureIndex(database, root);
    database.prepare('UPDATE index_manifest SET generation = ? WHERE singleton = 1').run(generation);
  } catch (error) {
    database.close();
    throw error;
  }
  database.close();
  await rename(temporaryDatabase, finalDatabase);
  const activePath = path.join(runtimeRoot, 'index-active.json');
  const activeTemporary = `${activePath}.${randomUUID()}.tmp`;
  await writeFile(activeTemporary, `${JSON.stringify({ generation, database: path.relative(runtimeRoot, finalDatabase), recordCount, switchedAt: new Date().toISOString() }, null, 2)}\n`, { flag: 'wx' });
  await rename(activeTemporary, activePath);
  return { generation, recordCount };
}
