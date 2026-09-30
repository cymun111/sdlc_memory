import { DatabaseSync } from 'node:sqlite';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

export async function openIndex(runtimeRoot = '.runtime'): Promise<DatabaseSync> {
  await mkdir(runtimeRoot, { recursive: true });
  const database = new DatabaseSync(path.join(runtimeRoot, 'knowledge.sqlite'));
  database.exec('PRAGMA journal_mode = WAL;');
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
