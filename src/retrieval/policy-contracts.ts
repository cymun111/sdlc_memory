import { z } from 'zod';
export const policyIssueSchema = z.object({ id: z.string().min(1).max(200), reason: z.enum(['needs_revalidation', 'dirty_worktree', 'unknown', 'revision_not_checked', 'approval_evidence_unavailable', 'disputed', 'conflict', 'review_due']) }).strict();
export type PolicyIssue = z.infer<typeof policyIssueSchema>;
