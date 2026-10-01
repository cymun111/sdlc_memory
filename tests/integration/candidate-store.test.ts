import { execFileSync } from 'node:child_process';
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { registerRepository, resolvePaths } from '../../src/core/config.js';
import { submitCandidate, updateCandidate, listCandidates, markCandidateState } from '../../src/capture/candidate-store.js';

let temporaryDirectory = '';
afterEach(async () => { if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true }); });

const candidate = `---\nschema_version: 1\nid: local.learning-one\ntitle: Durable local learning\nsummary: A candidate body should be preserved in full.\ntype: observed-behavior\nscope:\n  kind: repo\n  repo_id: sample-app\nstatus: candidate\nowner: local-owner\nsources: []\nrelationships: []\ncreated_at: "2026-09-30T00:00:00Z"\nupdated_at: "2026-09-30T00:00:00Z"\n---\n\n# Complete body\n\nRetain this paragraph exactly.\n`;

describe('durable local candidate intake', () => {
  it('replays the original receipt, preserves Markdown, and rejects key reuse with new content', async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'knowledge-capture-'));
    const source = path.join(temporaryDirectory, 'source');
    const root = path.join(temporaryDirectory, 'knowledge');
    await mkdir(source);
    await mkdir(path.join(root, 'schemas'), { recursive: true });
    await copyFile(path.resolve('schemas/knowledge.schema.json'), path.join(root, 'schemas/knowledge.schema.json'));
    execFileSync('git', ['init', source], { stdio: 'ignore' });
    const paths = await resolvePaths({ root });
    await registerRepository(paths, { id: 'sample-app', repoPath: source, owner: 'local-owner', team: 'platform' });

    const receipt = await submitCandidate(paths, { repoId: 'sample-app', idempotencyKey: 'task:1', markdown: candidate });
    const replay = await submitCandidate(paths, { repoId: 'sample-app', idempotencyKey: 'task:1', markdown: candidate });
    expect(replay.receipt_id).toBe(receipt.receipt_id);
    expect(replay.duplicate).toBe(true);
    expect(await readFile(receipt.candidate_path, 'utf8')).toBe(candidate);
    await expect(submitCandidate(paths, { repoId: 'sample-app', idempotencyKey: 'task:1', markdown: candidate.replace('Complete body', 'Changed body') })).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});

async function setupUpdate() {
  temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'knowledge-update-'));
  const source = path.join(temporaryDirectory, 'source');
  const root = path.join(temporaryDirectory, 'knowledge');
  await mkdir(source);
  await mkdir(path.join(root, 'schemas'), { recursive: true });
  await copyFile(path.resolve('schemas/knowledge.schema.json'), path.join(root, 'schemas/knowledge.schema.json'));
  execFileSync('git', ['init', source], { stdio: 'ignore' });
  const paths = await resolvePaths({ root });
  await registerRepository(paths, { id: 'sample-app', repoPath: source, owner: 'local-owner', team: 'platform' });
  const receipt = await submitCandidate(paths, { repoId: 'sample-app', idempotencyKey: 'original', markdown: candidate });
  return { paths, receipt, input: { repoId: 'sample-app', id: receipt.candidate_id, expectedHash: receipt.content_hash, markdown: candidate.replace('Complete body', 'Corrected body') } };
}

describe('candidate updates', () => {
  it('updates all receipt aliases, preserves original submission replay, and rejects stale edits', async () => {
    const { paths, receipt, input } = await setupUpdate();
    await submitCandidate(paths, { repoId: 'sample-app', idempotencyKey: 'alias', markdown: candidate });
    const updated = await updateCandidate(paths, input);
    expect(updated.receipt_id).toBe(receipt.receipt_id);
    expect(updated.content_hash).toBe(createHash('sha256').update(input.markdown).digest('hex'));
    expect((await listCandidates(paths))[0]?.hash).toBe(updated.content_hash);
    for (const key of ['original', 'alias']) {
      const replay = await submitCandidate(paths, { repoId: 'sample-app', idempotencyKey: key, markdown: candidate });
      expect(replay.content_hash).toBe(updated.content_hash);
      expect(replay.duplicate).toBe(true);
    }
    expect(await readFile(receipt.candidate_path, 'utf8')).toBe(input.markdown);
    await expect(submitCandidate(paths, { repoId: 'sample-app', idempotencyKey: 'original', markdown: input.markdown })).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(updateCandidate(paths, input)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect((await updateCandidate(paths, { ...input, expectedHash: updated.content_hash })).duplicate).toBe(true);
  });

  it.each([
    ['id: local.learning-one', 'id: local.other'],
    ['status: candidate', 'status: verified'],
    ['owner: local-owner', 'owner: other-owner'],
    ['repo_id: sample-app', 'repo_id: other-app'],
    ['created_at: "2026-09-30T00:00:00Z"', 'created_at: "2026-09-29T00:00:00Z"'],
    ['type: observed-behavior', 'type: invalid']
  ])('rejects an invalid or identity-changing replacement: %s', async (from, to) => {
    const { paths, receipt, input } = await setupUpdate();
    await expect(updateCandidate(paths, { ...input, markdown: candidate.replace(from, to) })).rejects.toThrow();
    expect(await readFile(receipt.candidate_path, 'utf8')).toBe(candidate);
    expect((await listCandidates(paths))[0]?.hash).toBe(receipt.content_hash);
  });

  it('rejects unauthorized writers and unknown repositories', async () => {
    const { paths, input } = await setupUpdate();
    await expect(updateCandidate(paths, { ...input, repoId: 'other-app' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    paths.config.principal = 'other-user';
    await expect(updateCandidate(paths, input)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it.each(['published', 'rejected'] as const)('refuses %s receipts even if a candidate file remains', async (state) => {
    const { paths, receipt, input } = await setupUpdate();
    markCandidateState(paths, receipt.candidate_id, state, receipt.candidate_path);
    await expect(updateCandidate(paths, input)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await readFile(receipt.candidate_path, 'utf8')).toBe(candidate);
  });

  it('allows only one of two competing updates from the same hash', async () => {
    const { paths, input } = await setupUpdate();
    const outcomes = await Promise.allSettled([updateCandidate(paths, input), updateCandidate(paths, { ...input, markdown: input.markdown + '\nAlternative.' })]);
    expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((result) => result.status === 'rejected')).toHaveLength(1);
  });

  it.each([false, true])('recovers a durable update journal on reopen (file already replaced: %s)', async (replaced) => {
    const { paths, receipt, input } = await setupUpdate();
    const hash = createHash('sha256').update(input.markdown).digest('hex');
    const ledger = new DatabaseSync(path.join(paths.runtimeRoot, 'receipts.sqlite'));
    ledger.prepare('INSERT INTO candidate_updates VALUES (?, ?, ?, ?, ?, ?)').run(input.repoId, input.id, input.expectedHash, hash, input.markdown, receipt.candidate_path);
    ledger.close();
    if (replaced) await writeFile(receipt.candidate_path, input.markdown);
    const reopened = await resolvePaths({ root: paths.knowledgeRoot });
    expect((await listCandidates(reopened))[0]?.hash).toBe(hash);
    expect((await submitCandidate(reopened, { repoId: input.repoId, idempotencyKey: 'original', markdown: candidate })).content_hash).toBe(hash);
    expect(await readFile(receipt.candidate_path, 'utf8')).toBe(input.markdown);
  });

  it('does not overwrite an untracked manual edit', async () => {
    const { paths, receipt, input } = await setupUpdate();
    const external = candidate + '\nManual change.';
    await writeFile(receipt.candidate_path, external);
    await expect(updateCandidate(paths, { ...input, expectedHash: createHash('sha256').update(external).digest('hex') })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await readFile(receipt.candidate_path, 'utf8')).toBe(external);
  });

  it('migrates a legacy ledger without losing original replay identity', async () => {
    const { paths, input } = await setupUpdate();
    const ledger = new DatabaseSync(path.join(paths.runtimeRoot, 'receipts.sqlite'));
    ledger.exec('ALTER TABLE submissions DROP COLUMN submission_hash; DROP TABLE candidate_updates;');
    ledger.close();
    const updated = await updateCandidate(paths, input);
    expect((await submitCandidate(paths, { repoId: input.repoId, idempotencyKey: 'original', markdown: candidate })).content_hash).toBe(updated.content_hash);
  });

  it('preserves a conflicting external edit when journal recovery cannot proceed', async () => {
    const { paths, receipt, input } = await setupUpdate();
    const ledger = new DatabaseSync(path.join(paths.runtimeRoot, 'receipts.sqlite'));
    ledger.prepare('INSERT INTO candidate_updates VALUES (?, ?, ?, ?, ?, ?)').run(input.repoId, input.id, input.expectedHash, createHash('sha256').update(input.markdown).digest('hex'), input.markdown, receipt.candidate_path);
    ledger.close();
    const external = candidate + '\nExternal edit.';
    await writeFile(receipt.candidate_path, external);
    await expect(listCandidates(paths)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await readFile(receipt.candidate_path, 'utf8')).toBe(external);
  });
});
