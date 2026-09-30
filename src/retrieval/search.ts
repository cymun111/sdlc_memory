import type { DatabaseSync } from 'node:sqlite';

export interface SearchHit {
  id: string;
  title: string;
  summary: string;
  type: string;
  scope_kind: string;
}

export function searchFixtureIndex(database: DatabaseSync, query: string, limit = 10): SearchHit[] {
  const boundedLimit = Math.max(1, Math.min(limit, 50));
  const rows = database.prepare(`SELECT r.id, r.title, r.summary, r.type, r.scope_kind
    FROM record_search s JOIN records r ON r.id = s.id
    WHERE record_search MATCH ? AND r.status = 'verified'
    ORDER BY bm25(record_search) LIMIT ?`).all(query, boundedLimit);
  return rows.map((row) => ({
    id: String(row.id),
    title: String(row.title),
    summary: String(row.summary),
    type: String(row.type),
    scope_kind: String(row.scope_kind)
  }));
}
