import { z } from 'zod';
import { publicKnowledgeSnapshotSchema as knowledgeSnapshotSchema, checkoutDriftSchema, applicationSourceSchema } from '../indexing/provenance.js';
import { conflictReferenceSchema } from '../capture/conflicts.js';
import { policyIssueSchema } from '../retrieval/policy-contracts.js';
import { onboardingState, setupStep, clientPreview } from '../onboarding/contracts.js';

export const contractVersion = 1 as const;
const text = z.string().min(1).max(200);
const repoId = z.string().regex(/^[a-z0-9][a-z0-9-]*$/).max(100);
const version = { contract_version: z.literal(contractVersion) };
const reference = { ...version, repo_id: text };
const relativePath = z.string().min(1).max(2000).refine((value) =>
  !value.startsWith('/') && !value.includes('\\') && !value.includes(':') && !value.split('/').includes('..'), 'Expected a repository-relative path');
const markdown = z.string().min(1).refine((value) => Buffer.byteLength(value, 'utf8') <= 65536, 'Markdown exceeds 65536 UTF-8 bytes');

export const setupRequest = z.object({ ...version, mode: z.enum(['plan', 'apply']), transport: z.literal('stdio'), repository: z.object({ id: repoId, path: z.string().min(1).max(4096), owner: text, team: text }).strict(), verify_service: z.boolean().default(true), client: z.enum(['manual','codex','claude-code','cursor']).default('manual') }).strict();
export const uninstallRequest = z.object(reference).strict();
export const readinessRequest = z.object(reference).strict();
export const retrievalRequest = z.object({ ...reference, task: z.string().trim().min(1).max(8000), topics: z.array(text).max(32).optional(), changed_paths: z.array(relativePath).max(100).optional(), source_revision: z.string().regex(/^[a-f0-9]{40}$/i).optional(), max_tokens: z.number().int().min(1).max(8000).optional(), max_results: z.number().int().min(1).max(12).optional(), depth: z.number().int().min(0).max(2).optional() }).strict();
export const deliveryRequest = retrievalRequest.extend({ task_id: text }).strict();
export const captureRequest = z.discriminatedUnion('outcome', [
  z.object({ ...reference, outcome: z.literal('learning'), idempotency_key: text, markdown }).strict(),
  z.object({ ...reference, outcome: z.literal('no-learning') }).strict()
]);

const scope = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('shared') }).strict(),
  z.object({ kind: z.literal('team'), team_id: text }).strict(),
  z.object({ kind: z.literal('repo'), repo_id: repoId }).strict(),
  z.object({ kind: z.literal('cross-repo'), repo_ids: z.array(repoId).min(1).max(100) }).strict()
]);
const summary = z.object({ id: text, title: z.string().max(1000), summary: z.string().max(600), type: z.enum(['observed-behavior', 'approved-policy', 'decision', 'practice', 'troubleshooting', 'overview']), scope, matched_reasons: z.array(text).max(100), evidence: z.array(z.record(z.string(), z.unknown())).max(100), freshness: text, relationships: z.array(z.object({ type: text, target: text }).strict()).max(100), editorial_status: z.enum(['verified', 'disputed', 'superseded']), normative: z.boolean(), requires_review: z.boolean() }).strict();
export const contextOutput = z.object({ status: z.enum(['ok', 'CONTEXT_BUDGET_EXCEEDED', 'POLICY_REVIEW_REQUIRED']), knowledge_revision: text, index_generation: text, knowledge_snapshot: knowledgeSnapshotSchema, checkout_drift: checkoutDriftSchema, application_source: applicationSourceSchema, results: z.array(summary).max(100), truncated: z.boolean(), estimated_tokens: z.number().int().nonnegative(), estimator_name: text, unresolved_conflicts: z.array(text).max(12), conflicts: z.array(conflictReferenceSchema).max(12), policy_issues: z.array(policyIssueSchema).max(12), omitted_conflict_count: z.number().int().nonnegative(), omitted_result_count: z.number().int().nonnegative(), omitted_mandatory_ids: z.array(text).max(12).optional() }).strict();
export const setupOutput = z.object({ ...version, state: onboardingState, repo_id: repoId, transport: z.literal('stdio'), writes: z.array(z.enum(['local-registration', 'repository-map', 'client-configuration','index'])).max(4), external_edits_authorized: z.literal(false), receipt_id: z.uuid().optional(), steps: z.array(setupStep).max(6).optional(), context_delivery_verified: z.literal(false).optional(), source_dirty: z.boolean().optional(), description_status: z.enum(['available','unavailable']).optional(), client_preview: clientPreview.optional(), source_revision: text.nullable().optional(), index_generation: text.nullable().optional() }).strict();
export const readinessOutput = z.object({ ...version, repo_id: repoId, state: z.enum(['registered', 'index-available']), index_generation: text.nullable(), knowledge_snapshot: knowledgeSnapshotSchema.nullable(), checkout_drift: checkoutDriftSchema.nullable(), context_delivery_verified: z.literal(false), scope_mode: z.literal('local-config-allowlist') }).strict();
export const retrievalOutput = z.object({ ...version, repo_id: repoId, context: contextOutput }).strict();
export const deliveryOutput = z.object({ ...version, repo_id: repoId, task_id: text, state: z.literal('prepared'), consumed: z.literal(false), context: contextOutput }).strict();
export const captureOutput = z.discriminatedUnion('state', [
  z.object({ ...version, repo_id: repoId, state: z.literal('no-learning'), durable: z.literal(false) }).strict(),
  z.object({ ...version, repo_id: repoId, state: z.literal('candidate'), candidate_id: text, receipt_id: text, content_hash: z.string().regex(/^[a-f0-9]{64}$/), duplicate: z.boolean() }).strict(),
  z.object({ ...version, repo_id: repoId, state: z.enum(['published', 'rejected']), candidate_id: text, receipt_id: text, content_hash: z.string().regex(/^[a-f0-9]{64}$/), duplicate: z.boolean() }).strict()
]);
export const errorOutput = z.object({ ...version, code: z.enum(['UNSUPPORTED_VERSION', 'VALIDATION_ERROR', 'NOT_FOUND', 'CONFLICT', 'CAPABILITY_UNAVAILABLE', 'FORBIDDEN', 'CONFLICT_STATE_UNAVAILABLE', 'INDEX_UNAVAILABLE', 'INDEX_REBUILD_REQUIRED', 'INDEX_SOURCE_CHANGED', 'INDEX_QUERY_FAILED', 'INDEX_SOURCE_UNAVAILABLE', 'INDEX_VALIDATION_FAILED', 'INDEX_BUILD_FAILED', 'CONTEXT_BUDGET_EXCEEDED', 'INTERNAL_ERROR']), message: z.string().max(300), retryable: z.boolean() }).strict();

export type IntegrationError = z.infer<typeof errorOutput>;
export class IntegrationContractError extends Error {
  readonly detail: IntegrationError;
  constructor(code: IntegrationError['code'], message: string, retryable = false) {
    super(message);
    this.detail = errorOutput.parse({ contract_version: contractVersion, code, message, retryable });
  }
}
export function parseRequest<T>(schema: z.ZodType<T>, value: unknown): T {
  if (value && typeof value === 'object' && 'contract_version' in value && value.contract_version !== contractVersion) {
    throw new IntegrationContractError('UNSUPPORTED_VERSION', 'Only contract_version 1 is supported.');
  }
  const result = schema.safeParse(value);
  if (!result.success) throw new IntegrationContractError('VALIDATION_ERROR', 'The integration request is invalid.');
  return result.data;
}
