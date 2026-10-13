import type { KnowledgeRecord } from '../core/types.js';
import { DomainError } from '../capture/candidate-store.js';

/** Validate the complete published tree, including retained historical records. */
export function validateRecordGraph(records: KnowledgeRecord[]): void {
  const byId = new Map<string, KnowledgeRecord>();
  const fail = () => { throw new DomainError('INDEX_VALIDATION_FAILED', 'Knowledge records or relationships are invalid.'); };
  for (const record of records) {
    if (byId.has(record.id)) fail();
    byId.set(record.id, record);
  }
  const supersession = new Map<string, string[]>();
  for (const record of records) {
    const targets = record.relationships.map((edge) => edge.target);
    const supersedes = record.supersedes as string[] | undefined;
    for (const target of [...targets, ...(supersedes ?? [])]) if (!byId.has(target)) fail();
    supersession.set(record.id, [...record.relationships.filter((edge) => edge.type === 'supersedes').map((edge) => edge.target), ...(supersedes ?? [])]);
  }
  // Iterative DFS avoids stack overflow on long histories. Other relationship cycles are allowed.
  const done = new Set<string>();
  for (const id of byId.keys()) {
    const visiting = new Set<string>();
    const stack: Array<{ id: string; exit: boolean }> = [{ id, exit: false }];
    while (stack.length) {
      const item = stack.pop()!;
      if (item.exit) { visiting.delete(item.id); done.add(item.id); continue; }
      if (visiting.has(item.id)) fail();
      if (done.has(item.id)) continue;
      visiting.add(item.id); stack.push({ id: item.id, exit: true });
      for (const target of supersession.get(item.id) ?? []) stack.push({ id: target, exit: false });
    }
  }
}
