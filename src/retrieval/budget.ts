import { createHash } from 'node:crypto';
import { z } from 'zod';
import { DomainError } from '../capture/candidate-store.js';
import type { LocalConfig } from '../core/config.js';
export const readOptions = z.object({ expected_generation:z.string().min(1).max(200).optional(),cursor:z.string().min(1).max(1024).optional(),max_bytes:z.number().int().min(1).max(32768).optional(),max_tokens:z.number().int().min(1).max(8000).optional() }).strict();
export type ReadOptions = z.infer<typeof readOptions>;
export const estimator = 'utf8-bytes-divided-by-3-conservative';
export const envelopeBytes = (value: unknown) => Buffer.byteLength(JSON.stringify({ok:true,data:value}),'utf8');
export function measured<T extends object>(value: T) {
  const result = {...value,estimated_tokens:0,estimator_name:estimator};
  for (let iteration=0;iteration<8;iteration++) { const next = Math.ceil(envelopeBytes(result)/3); if (next === result.estimated_tokens) break; result.estimated_tokens = next; }
  return result;
}
export function limits(config: LocalConfig, options: ReadOptions) { return {bytes:Math.min(config.budgets.maxBytes,options.max_bytes??config.budgets.maxBytes),tokens:Math.min(config.budgets.maxTokens,options.max_tokens??config.budgets.maxTokens)}; }
export function fits(value: unknown, cap: ReturnType<typeof limits>) { const size = envelopeBytes(value); return size<=cap.bytes && Math.ceil(size/3)<=cap.tokens; }
export function budgetError(): never { throw new DomainError('CONTEXT_BUDGET_EXCEEDED','The response cannot fit its metadata or next item; narrow the request or increase configured budgets.'); }
export function snapshot(value: unknown) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
export function continuation(key: string, offset: number) { return Buffer.from(JSON.stringify({snapshot:key,offset})).toString('base64url'); }
export function offsetFor(cursor: string|undefined,key: string,total: number) {
  if (!cursor) return 0;
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error();
    const value = z.object({snapshot:z.string(),offset:z.number().int().positive()}).strict().parse(JSON.parse(Buffer.from(cursor,'base64url').toString('utf8')));
    if (value.snapshot!==key || value.offset>=total) throw new Error(); return value.offset;
  } catch { throw new DomainError('VALIDATION_ERROR','Invalid or stale continuation; restart without a cursor.'); }
}
export function checkGeneration(actual: string,expected?: string) { if (expected && expected!==actual) throw new DomainError('CONFLICT','Index generation changed; restart summary retrieval before expansion.'); }
export function utf8End(bytes: Buffer,desired: number) { let end = Math.min(bytes.length,desired); while (end>0 && end<bytes.length && (bytes[end]!&0xc0)===0x80) end--; return end; }
