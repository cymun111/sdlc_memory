import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, writeFileSync, rmSync, lstatSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { RegisteredRepo, ResolvedPaths } from '../core/config.js';
import { parseKnowledgeMarkdown } from '../validation/record.js';

export class DomainError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

export interface CandidateReceipt {
  candidate_id: string;
  receipt_id: string;
  content_hash: string;
  state: 'candidate' | 'published' | 'rejected';
  candidate_path: string;
  duplicate: boolean;
}

function openLedger(paths: ResolvedPaths): DatabaseSync {
  mkdirSync(paths.runtimeRoot, { recursive: true });
  const database = new DatabaseSync(path.join(paths.runtimeRoot, 'receipts.sqlite'));
  database.exec(`PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 10000;
    CREATE TABLE IF NOT EXISTS submissions (
      idempotency_key TEXT PRIMARY KEY,
      repo_id TEXT NOT NULL,
      candidate_id TEXT NOT NULL,
      receipt_id TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      candidate_path TEXT NOT NULL,
      submitter TEXT NOT NULL,
      state TEXT NOT NULL,
      created_at TEXT NOT NULL,
      rejection_reason TEXT
    );
    CREATE INDEX IF NOT EXISTS submissions_content ON submissions(repo_id, content_hash);
    CREATE TABLE IF NOT EXISTS conflict_reports (
      id TEXT PRIMARY KEY,
      receipt_id TEXT NOT NULL UNIQUE,
      record_ids_json TEXT NOT NULL,
      explanation TEXT NOT NULL,
      evidence_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );`);
  try {
    database.exec('BEGIN IMMEDIATE');
    const columns = database.prepare('PRAGMA table_info(submissions)').all();
    if (!columns.some((column) => column.name === 'submission_hash')) {
      database.exec('ALTER TABLE submissions ADD COLUMN submission_hash TEXT; UPDATE submissions SET submission_hash = content_hash;');
    }
    database.exec(`CREATE TABLE IF NOT EXISTS candidate_updates (
      repo_id TEXT NOT NULL, candidate_id TEXT NOT NULL, expected_hash TEXT NOT NULL,
      content_hash TEXT NOT NULL, markdown TEXT NOT NULL, candidate_path TEXT NOT NULL,
      PRIMARY KEY (repo_id, candidate_id)
    );`);
    recoverUpdates(database, paths);
    database.exec('COMMIT');
    return database;
  } catch (error) {
    if (database.isTransaction) database.exec('ROLLBACK');
    database.close();
    throw error;
  }
}

function hashMarkdown(markdown: string): string {
  return createHash('sha256').update(markdown).digest('hex');
}

function safeExistingCandidate(paths: ResolvedPaths, repoId: string, id: string): string {
  if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(id)) throw new DomainError('VALIDATION_ERROR', 'Invalid candidate ID');
  const filename = path.join(paths.knowledgeRoot, 'candidates', repoId, `${id}.md`);
  if (!existsSync(filename)) throw new DomainError('NOT_FOUND', 'Pending candidate not found');
  if (!lstatSync(filename).isFile() || realpathSync(filename) !== filename) throw new DomainError('FORBIDDEN', 'Candidate path must not resolve through a symlink');
  return filename;
}

// The committed journal bridges the filesystem/SQLite boundary. Recovery accepts only
// the inspected old file or the exact replacement; unrelated edits are never overwritten.
function recoverUpdates(database: DatabaseSync, paths: ResolvedPaths): void {
  for (const row of database.prepare('SELECT * FROM candidate_updates').all()) {
    const filename = safeExistingCandidate(paths, String(row.repo_id), String(row.candidate_id));
    if (filename !== row.candidate_path) throw new DomainError('CONFLICT', 'Pending update path changed');
    const current = hashMarkdown(readFileSync(filename, 'utf8'));
    if (current !== row.expected_hash && current !== row.content_hash) throw new DomainError('CONFLICT', 'Pending update conflicts with an external candidate edit');
    if (current !== row.content_hash) {
      const temporary = `${filename}.${randomUUID()}.tmp`;
      try {
        writeFileSync(temporary, String(row.markdown), { flag: 'wx', mode: 0o600, flush: true });
        renameSync(temporary, filename);
      } finally { rmSync(temporary, { force: true }); }
    }
    database.prepare("UPDATE submissions SET content_hash = ? WHERE repo_id = ? AND candidate_id = ? AND state = 'accepted'")
      .run(String(row.content_hash), String(row.repo_id), String(row.candidate_id));
    database.prepare('DELETE FROM candidate_updates WHERE repo_id = ? AND candidate_id = ?').run(String(row.repo_id), String(row.candidate_id));
  }
}

export async function updateCandidate(paths: ResolvedPaths, input: { repoId: string; id: string; expectedHash: string; markdown: string }): Promise<CandidateReceipt> {
  const repo = resolveRepo(paths, input.repoId);
  if (!/^[a-f0-9]{64}$/.test(input.expectedHash)) throw new DomainError('VALIDATION_ERROR', 'expected_hash must be a lowercase SHA-256 hash');
  if (Buffer.byteLength(input.markdown, 'utf8') > 65536) throw new DomainError('VALIDATION_ERROR', 'Candidate exceeds 65536 UTF-8 bytes');
  const replacement = await parseKnowledgeMarkdown(input.markdown, paths.knowledgeRoot);
  if (replacement.id !== input.id || replacement.status !== 'candidate') throw new DomainError('VALIDATION_ERROR', 'Replacement must retain the candidate ID and candidate status');
  if (replacement.owner !== repo.owner) throw new DomainError('FORBIDDEN', 'Candidate owner must match the registered repository');
  if (paths.config.principal !== repo.owner) throw new DomainError('FORBIDDEN', 'Only the configured repository owner may update candidates');
  // Resolve any interrupted update before inspection, without holding a transaction across await.
  openLedger(paths).close();
  const filename = safeExistingCandidate(paths, repo.id, input.id);
  const original = await parseKnowledgeMarkdown(readFileSync(filename, 'utf8'), paths.knowledgeRoot);
  if (original.status !== 'candidate') throw new DomainError('CONFLICT', 'Only pending candidates may be updated');
  if (replacement.owner !== original.owner || !isDeepStrictEqual(replacement.scope, original.scope) || replacement.created_at !== original.created_at) {
    throw new DomainError('VALIDATION_ERROR', 'Updates must preserve owner, scope, and created_at');
  }
  const hash = hashMarkdown(input.markdown);
  const database = openLedger(paths);
  try {
    database.exec('BEGIN IMMEDIATE');
    const rows = database.prepare('SELECT * FROM submissions WHERE repo_id = ? AND candidate_id = ?').all(repo.id, input.id);
    if (!rows.length) throw new DomainError('NOT_FOUND', 'Candidate has no submission receipt');
    if (rows.some((row) => row.state !== 'accepted')) throw new DomainError('CONFLICT', 'Only accepted pending candidates may be updated');
    const current = hashMarkdown(readFileSync(safeExistingCandidate(paths, repo.id, input.id), 'utf8'));
    if (current !== input.expectedHash || rows.some((row) => row.content_hash !== current || row.candidate_path !== filename)) {
      throw new DomainError('CONFLICT', 'Candidate changed or its receipt is inconsistent; inspect it again');
    }
    const row = rows[0]!;
    if (hash !== current) {
      database.prepare('INSERT INTO candidate_updates (repo_id, candidate_id, expected_hash, content_hash, markdown, candidate_path) VALUES (?, ?, ?, ?, ?, ?)')
        .run(repo.id, input.id, current, hash, input.markdown, filename);
    }
    database.exec('COMMIT');
    database.exec('BEGIN IMMEDIATE');
    recoverUpdates(database, paths);
    database.exec('COMMIT');
    return receiptFromRow({ ...row, content_hash: hash }, hash === current);
  } catch (error) {
    if (database.isTransaction) database.exec('ROLLBACK');
    throw error;
  } finally { database.close(); }
}

function resolveRepo(paths: ResolvedPaths, repoId: string): RegisteredRepo {
  const repository = paths.config.repositories.find((repo) => repo.id === repoId || repo.aliases.includes(repoId));
  if (!repository) throw new DomainError('NOT_FOUND', `Repository is not registered: ${repoId}`);
  return repository;
}

function candidatePath(paths: ResolvedPaths, repoId: string, id: string): string {
  const candidateRoot = path.resolve(paths.knowledgeRoot, 'candidates');
  const directory = path.join(candidateRoot, repoId);
  mkdirSync(directory, { recursive: true });
  const realRoot = realpathSync(candidateRoot);
  const realDirectory = realpathSync(directory);
  if (realRoot !== candidateRoot || !realDirectory.startsWith(`${realRoot}${path.sep}`)) {
    throw new DomainError('FORBIDDEN', 'Candidate directory resolves outside the knowledge root');
  }
  return path.join(realDirectory, `${id}.md`);
}

function writeCandidate(filename: string, markdown: string, expectedHash: string): void {
  if (existsSync(filename)) {
    const existingHash = createHash('sha256').update(readFileSync(filename)).digest('hex');
    if (existingHash !== expectedHash) throw new DomainError('CONFLICT', `Candidate ID already exists with different content: ${path.basename(filename, '.md')}`);
    return;
  }
  const temporary = `${filename}.${randomUUID()}.tmp`;
  writeFileSync(temporary, markdown, { flag: 'wx', mode: 0o600 });
  try { renameSync(temporary, filename); }
  catch (error) {
    if (!existsSync(filename)) throw error;
    const existingHash = createHash('sha256').update(readFileSync(filename)).digest('hex');
    if (existingHash !== expectedHash) throw new DomainError('CONFLICT', 'Concurrent candidate creation had different content');
  }
}

function receiptFromRow(row: Record<string, unknown>, duplicate: boolean): CandidateReceipt {
  return {
    candidate_id: String(row.candidate_id),
    receipt_id: String(row.receipt_id),
    content_hash: String(row.content_hash),
    state: row.state === 'published' || row.state === 'rejected' ? row.state : 'candidate',
    candidate_path: String(row.candidate_path),
    duplicate
  };
}

export async function submitCandidate(paths: ResolvedPaths, input: { repoId: string; idempotencyKey: string; markdown: string; submitter?: string }): Promise<CandidateReceipt> {
  const repo = resolveRepo(paths, input.repoId);
  if (!input.idempotencyKey.trim() || input.idempotencyKey.length > 200) throw new DomainError('VALIDATION_ERROR', 'Idempotency key must contain 1-200 characters');
  const record = await parseKnowledgeMarkdown(input.markdown, paths.knowledgeRoot);
  if (record.status !== 'candidate') throw new DomainError('VALIDATION_ERROR', 'New submissions must use candidate status');
  if (record.owner !== repo.owner) throw new DomainError('FORBIDDEN', `Candidate owner must match registered owner ${repo.owner}`);
  if (record.scope.kind === 'repo' && record.scope.repo_id !== repo.id) throw new DomainError('FORBIDDEN', 'Candidate scope does not match the registered repository');
  if (record.scope.kind === 'cross-repo' && !record.scope.repo_ids.includes(repo.id)) throw new DomainError('FORBIDDEN', 'Cross-repo candidate scope must include the registered repository');
  if (record.scope.kind === 'team' && record.scope.team_id !== repo.team) throw new DomainError('FORBIDDEN', 'Candidate team scope does not match the registered repository');
  const hash = createHash('sha256').update(input.markdown).digest('hex');
  const destination = candidatePath(paths, repo.id, record.id);
  const database = openLedger(paths);
  let row: Record<string, unknown>;
  let duplicate = false;
  try {
    database.exec('BEGIN IMMEDIATE');
    const existingKey = database.prepare('SELECT * FROM submissions WHERE idempotency_key = ?').get(input.idempotencyKey) as Record<string, unknown> | undefined;
    if (existingKey) {
      if (existingKey.repo_id !== repo.id || (existingKey.submission_hash ?? existingKey.content_hash) !== hash) throw new DomainError('CONFLICT', 'Idempotency key was already used with different content or repository');
      row = existingKey;
      duplicate = true;
    } else {
      const existingContent = database.prepare('SELECT * FROM submissions WHERE repo_id = ? AND content_hash = ? AND state != ? LIMIT 1').get(repo.id, hash, 'rejected') as Record<string, unknown> | undefined;
      if (existingContent) {
        row = { ...existingContent, idempotency_key: input.idempotencyKey };
        database.prepare(`INSERT INTO submissions (idempotency_key, repo_id, candidate_id, receipt_id, content_hash, candidate_path, submitter, state, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(input.idempotencyKey, repo.id, String(existingContent.candidate_id), String(existingContent.receipt_id), hash, String(existingContent.candidate_path), input.submitter ?? paths.config.principal, String(existingContent.state), String(existingContent.created_at));
        duplicate = true;
      } else {
        const receiptId = randomUUID();
        const createdAt = new Date().toISOString();
        database.prepare(`INSERT INTO submissions (idempotency_key, repo_id, candidate_id, receipt_id, content_hash, candidate_path, submitter, state, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?)`).run(input.idempotencyKey, repo.id, record.id, receiptId, hash, destination, input.submitter ?? paths.config.principal, createdAt);
        row = { candidate_id: record.id, receipt_id: receiptId, content_hash: hash, candidate_path: destination, state: 'queued' };
      }
    }
    database.prepare('UPDATE submissions SET submission_hash = ? WHERE idempotency_key = ? AND submission_hash IS NULL').run(hash, input.idempotencyKey);
    if (row.state !== 'published' && row.state !== 'rejected' && row.content_hash === hash) writeCandidate(String(row.candidate_path), input.markdown, hash);
    database.prepare("UPDATE submissions SET state = 'accepted' WHERE receipt_id = ? AND state = 'queued'").run(String(row.receipt_id));
    database.exec('COMMIT');
  } catch (error) {
    if (database.isTransaction) database.exec('ROLLBACK');
    throw error;
  } finally { database.close(); }

  return receiptFromRow(row, duplicate);
}

export function pendingSubmissionCount(paths: ResolvedPaths): number {
  const database = openLedger(paths);
  try { return Number((database.prepare("SELECT COUNT(*) AS count FROM submissions WHERE state = 'queued'").get() as { count: number }).count); }
  finally { database.close(); }
}

export function markCandidateState(paths: ResolvedPaths, candidateId: string, state: 'published' | 'rejected', archivePath: string, reason?: string): void {
  const database = openLedger(paths);
  try {
    database.prepare('UPDATE submissions SET state = ?, candidate_path = ?, rejection_reason = ? WHERE candidate_id = ? AND state IN (?, ?)')
      .run(state, archivePath, reason ?? null, candidateId, 'accepted', 'queued');
  } finally { database.close(); }
}

export function persistConflictReport(paths: ResolvedPaths, report: { id: string; receipt_id: string; record_ids: string[]; explanation: string; evidence: Array<Record<string, unknown>> }): void {
  const database = openLedger(paths);
  try {
    database.prepare(`INSERT INTO conflict_reports (id, receipt_id, record_ids_json, explanation, evidence_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`).run(report.id, report.receipt_id, JSON.stringify(report.record_ids), report.explanation, JSON.stringify(report.evidence), new Date().toISOString());
  } finally { database.close(); }
}

export async function listCandidates(paths: ResolvedPaths, repoId?: string): Promise<Array<{ id: string; repo_id: string; hash: string; path: string; title: string; summary: string }>> {
  openLedger(paths).close();
  const repos = repoId ? [resolveRepo(paths, repoId)] : paths.config.repositories;
  const results: Array<{ id: string; repo_id: string; hash: string; path: string; title: string; summary: string }> = [];
  for (const repo of repos) {
    const directory = path.join(paths.knowledgeRoot, 'candidates', repo.id);
    if (!existsSync(directory)) continue;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith('.md')) continue;
      const filename = path.join(directory, entry.name);
      const markdown = readFileSync(filename, 'utf8');
      const record = await parseKnowledgeMarkdown(markdown, paths.knowledgeRoot);
      results.push({ id: record.id, repo_id: repo.id, hash: createHash('sha256').update(markdown).digest('hex'), path: filename, title: record.title, summary: record.summary });
    }
  }
  return results;
}
