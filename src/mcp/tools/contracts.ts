import { z } from 'zod';

export const toolContracts = {
  get_task_context: z.object({ repo_id: z.string(), task: z.string(), topics: z.array(z.string()).optional(), changed_paths: z.array(z.string()).optional(), source_revision: z.string().optional(), max_tokens: z.number().int().positive().optional(), max_results: z.number().int().positive().optional(), depth: z.number().int().min(0).max(2).optional() }),
  search_knowledge: z.object({ query: z.string(), repo_id: z.string().optional(), scope: z.string().optional(), limit: z.number().int().min(1).max(50).optional() }),
  get_knowledge: z.object({ id: z.string(), repo_id: z.string().optional(), byte_limit: z.number().int().min(1).max(32768).optional() }),
  get_related: z.object({ id: z.string(), repo_id: z.string().optional(), relation_types: z.array(z.string()).optional(), depth: z.number().int().min(0).max(2).optional(), limit: z.number().int().min(1).max(50).optional() }),
  submit_learning: z.object({ repo_id: z.string(), idempotency_key: z.string().min(1).max(200), learning: z.object({ markdown: z.string().min(1).max(65536) }) }),
  update_candidate: z.object({ repo_id: z.string().min(1), id: z.string().regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/), expected_hash: z.string().regex(/^[a-f0-9]{64}$/), learning: z.object({ markdown: z.string().min(1).max(65536) }) }),
  report_conflict: z.object({ repo_id: z.string(), record_ids: z.array(z.string()).min(2).max(20), explanation: z.string().min(1).max(4000), evidence: z.array(z.record(z.string(), z.unknown())).optional() })
};

export const toolOutput = z.object({ ok: z.boolean(), data: z.record(z.string(), z.unknown()) });
