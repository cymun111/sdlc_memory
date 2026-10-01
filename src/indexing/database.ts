import { DatabaseSync } from 'node:sqlite';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

export async function openIndex(runtimeRoot = '.runtime', databasePath?: string): Promise<DatabaseSync> {
  await mkdir(runtimeRoot, { recursive: true });
  let resolvedDatabase = databasePath ?? path.join(runtimeRoot, 'knowledge.sqlite');
  if (!databasePath) {
    try {
      const active = JSON.parse(await readFile(path.join(runtimeRoot, 'index-active.json'), 'utf8')) as { database: string };
      const candidate = path.resolve(runtimeRoot, active.database);
      if (!candidate.startsWith(`${path.resolve(runtimeRoot)}${path.sep}`)) throw new Error('Active index path escapes runtime root');
      resolvedDatabase = candidate;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  const database = new DatabaseSync(resolvedDatabase);
  database.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  database.exec(`
    CREATE TABLE IF NOT EXISTS records (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      type TEXT NOT NULL,
      scope_kind TEXT NOT NULL,
      scope_json TEXT NOT NULL,
      status TEXT NOT NULL,
      body TEXT NOT NULL,
      content_hash TEXT NOT NULL
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS record_search USING fts5(id UNINDEXED, title, summary, body);
    CREATE TABLE IF NOT EXISTS edges (
      source_id TEXT NOT NULL,
      relation TEXT NOT NULL,
      target_id TEXT NOT NULL,
      PRIMARY KEY (source_id, relation, target_id)
    );
    CREATE TABLE IF NOT EXISTS index_manifest (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      knowledge_commit TEXT,
      generation TEXT NOT NULL,
      built_at TEXT NOT NULL,
      record_count INTEGER NOT NULL
    );
  `);
  return database;
}
