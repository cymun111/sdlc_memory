import { DatabaseSync } from 'node:sqlite';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { DomainError } from '../capture/candidate-store.js';

export async function openIndex(runtimeRoot = '.runtime', databasePath?: string): Promise<DatabaseSync> {
  if (!databasePath) {
    let database: DatabaseSync | undefined;
    try {
      const active = JSON.parse(await readFile(path.join(runtimeRoot, 'index-active.json'), 'utf8')) as { database?: unknown; generation?: unknown };
      if (typeof active.database !== 'string' || typeof active.generation !== 'string' || !active.generation) throw new Error('Invalid active manifest');
      const candidate = path.resolve(runtimeRoot, active.database);
      if (!candidate.startsWith(`${path.resolve(runtimeRoot)}${path.sep}`)) throw new Error('Active index path escapes runtime root');
      database = new DatabaseSync(candidate, { readOnly: true });
      const manifest = database.prepare('SELECT generation FROM index_manifest WHERE singleton = 1').get();
      if (!manifest || manifest.generation !== active.generation) throw new Error('Invalid index generation');
      return database;
    } catch {
      database?.close();
      throw new DomainError('INDEX_UNAVAILABLE', 'The active index is unavailable; rebuild with knowledge index --full.');
    }
  }
  await mkdir(runtimeRoot, { recursive: true });
  const database = new DatabaseSync(databasePath);
  try {
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
  } catch (error) { database.close(); throw error; }
}
