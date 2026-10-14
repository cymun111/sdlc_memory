import { z } from 'zod';
import { readOptions } from '../../retrieval/budget.js';

export const toolContracts = {
  get_task_context: z.object({ repo_id: z.string(), task: z.string().max(8000), topics: z.array(z.string().max(200)).max(32).optional(), changed_paths: z.array(z.string().max(2000)).max(100).optional(), source_revision: z.string().optional(), max_tokens: z.number().int().min(1).max(8000).optional(), max_results: z.number().int().positive().optional(), depth: z.number().int().min(0).max(2).optional(),expected_generation:readOptions.shape.expected_generation,max_bytes:readOptions.shape.max_bytes }),
  search_knowledge: z.object({ query: z.string().max(8000), repo_id: z.string().optional(), scope: z.string().optional(), limit: z.number().int().min(1).max(50).optional(),...readOptions.shape }),
  get_knowledge: z.object({ id: z.string(), repo_id: z.string().optional(), byte_limit: z.number().int().min(1).max(32768).optional(), include_history: z.boolean().optional(),...readOptions.shape }),
  get_related: z.object({ id: z.string(), repo_id: z.string().optional(), relation_types: z.array(z.string()).max(10).optional(), depth: z.number().int().min(0).max(2).optional(), limit: z.number().int().min(1).max(50).optional(),...readOptions.shape }),
  submit_learning: z.object({ repo_id: z.string(), idempotency_key: z.string().min(1).max(200), learning: z.object({ markdown: z.string().min(1).max(65536) }) }),
  update_candidate: z.object({ repo_id: z.string().min(1), id: z.string().regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/), expected_hash: z.string().regex(/^[a-f0-9]{64}$/), learning: z.object({ markdown: z.string().min(1).max(65536) }) }),
  report_conflict: z.object({ repo_id: z.string(), record_ids: z.array(z.string()).min(2).max(20), explanation: z.string().min(1).max(4000), evidence: z.array(z.record(z.string(), z.unknown())).optional() })
};

export const toolOutput = z.object({ ok: z.boolean(), data: z.record(z.string(), z.unknown()) });
