import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { parseKnowledgeMarkdown } from '../validation/record.js';

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
    return { record: parseKnowledgeMarkdown(body), body };
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
