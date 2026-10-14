import { z } from 'zod';
export const onboardingState = z.enum(['planned','configured','service-verified','context-delivery-verified','degraded','failed','uninstalled']);
export const stepNames = ['registration','map','index','client_configuration','tool_discovery','scoped_read'] as const;
export const setupStep = z.object({ name: z.enum(stepNames), state: z.enum(['pending','complete','degraded','failed']), fingerprint: z.string().max(64), attempts: z.number().int().nonnegative(), verified_at: z.string().nullable(), retryable: z.boolean(), diagnostic: z.string().max(200).nullable() }).strict();
export const clientPreview = z.object({ command: z.string().max(4096), args: z.array(z.string().max(4096)).max(10), native_client_verified: z.literal(false), external_edits_authorized: z.literal(false) }).strict();
const registration = z.object({ id: z.string(), name: z.string(), path: z.string(), owner: z.string(), team: z.string(), aliases: z.array(z.string()) }).strict();
export const onboardingReceipt = z.object({
  schema_version: z.literal(1), receipt_id: z.uuid(), repo_id: z.string(), principal: z.string(), fingerprint: z.string(),
  state: onboardingState, created_at: z.string(), updated_at: z.string(), source_revision: z.string().nullable(), index_generation: z.string().nullable(),
  registration_before: registration.nullable(), registration_snapshot: registration, owned_registration: z.boolean(), owned_map: z.boolean(), map_hash: z.string().nullable(),
  launch_hash: z.string().nullable(), steps: z.array(setupStep).length(6), source_dirty: z.boolean(),
  context_delivery_verified: z.literal(false), description_status: z.enum(['available','unavailable']), client_preview: clientPreview
}).strict();
export type OnboardingReceipt = z.infer<typeof onboardingReceipt>;
