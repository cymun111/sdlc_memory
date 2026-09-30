import { z } from 'zod';

export const toolContracts = {
  get_task_context: z.object({ repo_id: z.string(), task: z.string(), topics: z.array(z.string()).optional(), changed_paths: z.array(z.string()).optional(), source_revision: z.string().optional() }),
  search_knowledge: z.object({ query: z.string(), scope: z.string().optional(), limit: z.number().int().min(1).max(50).optional() }),
  get_knowledge: z.object({ id: z.string(), byte_limit: z.number().int().min(1).max(32768).optional() }),
  get_related: z.object({ id: z.string(), relation_types: z.array(z.string()).optional(), depth: z.number().int().min(0).max(2).optional(), limit: z.number().int().min(1).max(50).optional() }),
  submit_learning: z.object({ idempotency_key: z.string().min(1), learning: z.record(z.string(), z.unknown()) }),
  report_conflict: z.object({ record_ids: z.array(z.string()).min(2), explanation: z.string(), evidence: z.array(z.record(z.string(), z.unknown())).optional() })
};
