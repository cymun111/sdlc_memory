import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { KnowledgeRecord } from '../core/types.js';

export interface CandidateReceipt {
  candidate_id: string;
  receipt_id: string;
  content_hash: string;
  state: 'candidate';
  pr_url: null;
}

export async function submitLocalCandidate(root: string, repoId: string, payload: KnowledgeRecord): Promise<CandidateReceipt> {
  if (payload.status !== 'candidate') throw new Error('Submissions must use candidate status');
  const safeRepoId = /^[a-z0-9][a-z0-9-]*$/.test(repoId);
  if (!safeRepoId) throw new Error('Invalid repository identifier');
  const destination = path.resolve(root, 'candidates', repoId, `${payload.id.replaceAll('.', '-')}.md`);
  const candidateRoot = path.resolve(root, 'candidates');
  if (!destination.startsWith(`${candidateRoot}${path.sep}`)) throw new Error('Candidate path escapes configured root');
  await mkdir(path.dirname(destination), { recursive: true });
  const body = `---\n${Object.entries(payload).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join('\n')}\n---\n\n# ${payload.title}\n\n${payload.summary}\n`;
  const hash = createHash('sha256').update(body).digest('hex');
  await writeFile(destination, body, { flag: 'wx' });
  return { candidate_id: payload.id, receipt_id: randomUUID(), content_hash: hash, state: 'candidate', pr_url: null };
}
