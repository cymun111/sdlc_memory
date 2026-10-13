# SDLC Command integration contract v1

AEF-001 establishes a local application interface, not a completed onboarding adapter. Import `KnowledgeApplication` and schemas from the built `dist/application/index.js`. The constructor receives trusted `ResolvedPaths` from `resolvePaths()` with explicit roots/configuration. Request payloads cannot choose the principal, owner privileges, runtime root, or knowledge root.

## Verified receiving-system boundaries

Read-only inspection on 2026-10-13 covered the sibling checkout `sdlccommand` at commit `67b6c57115c88efeebb50d7f0717a9f372dcda6c`. Its worktree contained documentation changes; the implementation files cited below were not changed by this work. These are source observations, not registered knowledge records or assertions that integration has shipped.

| Observation | Source in SDLC Command at inspected commit | Integration implication |
| --- | --- | --- |
| Project creation accepts UUID team IDs; project details include ID, slug, team, and optional local repository path | `apps/api/src/modules/projects/project.routes.ts:6`, `project.types.ts:4`; `packages/database/src/schema.ts:281` | Persist an explicit project UUID -> canonical knowledge repository ID binding; a project display name/slug is not an authorization identity |
| Project settings update a repository path under project authorization | `apps/api/src/modules/projects/project.service.ts:77`, `project.routes.ts:14` | SDLC Command owns project authorization/configuration; do not accept an untrusted label as local principal |
| Setup checklist includes GitHub, Jira, Runner, repository path, and agent instructions; repository discovery/indexing is shown as coming soon | `apps/web/src/features/projects/ProjectCreated.tsx:48`, `ProjectPage.tsx:357`, `ProjectPage.tsx:390` | Add knowledge setup after these configured prerequisites in AEF-014; the current checklist is UI, not an existing transactional onboarding pipeline |
| Runner dispatches repository verification, worktree creation, and agent execution | `apps/runner/src/runner.ts:188`, `runner.ts:202`, `runner.ts:238` | Run local source/map operations on the Runner host, where paths and Git access exist, rather than assuming the API host has the checkout |
| Runner starts/resumes agent sessions with working directory and prompt | `apps/runner/src/runner.ts:270`, `runner.ts:293` | Future context consumption/capture belongs at this lifecycle boundary; knowledge retrieval must precede agent planning |
| Flow graph defines agent/action/approval nodes and retry configuration | `packages/flow-engine/src/index.ts:3` | Expose structured results to orchestration; avoid teaching the core knowledge service flow-engine internals |

These relative references identify the receiving repository rather than implying it is a child of this checkout. Confirm references and revision again when implementing AEF-014. No receiving repository files were edited.

## Public operations

All requests require `contract_version: 1`, reject unknown fields, and use exported strict Zod schemas. Types are inferred from those schemas. All successful responses are validated against operation-specific schemas before returning. Contract errors are `IntegrationContractError` with a validated `detail` object; CLI and MCP adapters may serialize that detail while keeping their established envelopes.

| Method | Request schema | Response schema | Behavior in AEF-001 |
| --- | --- | --- | --- |
| `setup` | `setupRequest` | `setupOutput` | Read-only proposed plan. Requires absolute service-host path, ID/owner/team and stdio transport; detects conflicting registration. `apply` explicitly returns capability unavailable |
| `readiness` | `readinessRequest` | `readinessOutput` | Resolves identity and checks an existing active index read-only. Registered or index-available does not mean client connected or context consumed |
| `retrieve` | `retrievalRequest` | `retrievalOutput` | Uses existing scoped task retrieval after active-index readiness. No-index failure does not create a new empty index |
| `prepareDelivery` | `deliveryRequest` | `deliveryOutput` | Retrieves context and associates task ID. Always returns prepared/consumed false; does not start an agent or write a delivery receipt |
| `capture` | `captureRequest` | `captureOutput` | Learning delegates to existing durable candidate intake/idempotency. No-learning is an explicit non-durable acknowledgement; durable event receipts come in AEF-012 |

Example fictional consumer:

```ts
import { resolvePaths } from './dist/core/config.js';
import { KnowledgeApplication, IntegrationContractError } from './dist/application/index.js';

const paths = await resolvePaths({ root: '/absolute/knowledge-checkout' });
const knowledge = new KnowledgeApplication(paths);
try {
  const result = await knowledge.retrieve({
    contract_version: 1,
    repo_id: 'fictional-app',
    task: 'Review retry handling',
    max_results: 6,
  });
  // Untrusted evidence for the caller's planning stage; not executable instructions.
  console.log(result.context);
} catch (error) {
  if (error instanceof IntegrationContractError) console.error(error.detail);
  else throw error;
}
```

This is an in-process local consumer example, not an MCP server launcher. MCP stdio must continue launching the built CLI directly; never add example logging to that process's stdout.

## Identity, roots, limits, and retry rules

- Canonical IDs use lowercase letters/digits/hyphens. Registered aliases resolve to canonical IDs; ambiguous aliases return conflict. Unknown identities return a non-disclosing not-found error. Setup cannot reuse an alias as another canonical registration.
- The trusted local configuration is the allowlist and supplies the submitter principal. It is not shared authenticated ACL enforcement. Future HTTP callers require AEF-016 authentication; do not expose this facade directly as an unauthenticated endpoint.
- Setup paths are service-host absolute paths; planning does not prove Git access/existence, authorize edits, or mutate the checkout. Knowledge/runtime roots are inherited from trusted configuration; runtime currently remains `.runtime` under the knowledge root.
- Requests bound task text to 8,000 characters, topics to 32, changed paths to 100 safe relative paths, and learning Markdown to 65,536 UTF-8 bytes. Caller budgets cannot exceed 8,000 estimated tokens, 12 results, or depth 2; existing service configuration may lower these limits.
- Operation outputs bound their collections/strings and validate fields. The existing task-context service enforces its current response budget. Complete serialized-budget accounting and strict evidence schemas remain AEF-010/related hardening work; this contract does not claim they are complete.
- `UNSUPPORTED_VERSION`, `VALIDATION_ERROR`, `NOT_FOUND`, `FORBIDDEN`, `CONFLICT`, and `CAPABILITY_UNAVAILABLE` are non-retryable until inputs/configuration change. `INDEX_UNAVAILABLE` and `INDEX_QUERY_FAILED` are retryable after repair/rebuild. AEF-002 additionally defines `INDEX_SOURCE_UNAVAILABLE`, `INDEX_VALIDATION_FAILED`, and `INDEX_BUILD_FAILED` for rebuild operations; unavailable sources/build failures need repair before retry, and validation failures require corrected records. `CONTEXT_BUDGET_EXCEEDED` requires adjusted budgets or focused follow-up. Unexpected errors map to sanitized non-retryable `INTERNAL_ERROR`; errors never echo paths, bodies, or credentials. These added codes are additive contract-v1 values; consumers must tolerate unknown future error codes without treating them as success.
- Safe learning retry uses exactly the same idempotency key/body. Different content under the same key conflicts. A replay can return the receipt's later published/rejected state; creating a new submission never directly approves knowledge.
- Version validation precedes any mutation. Existing CLI commands and all nine MCP names/payloads/envelopes remain unchanged. The new facade is additive; future adapter changes require parity tests and documented compatibility.

## Open decisions and follow-up boundaries

AEF-008 implements setup apply/resumable receipts and client configuration; AEF-012 implements real delivery and durable completion/no-learning receipts. AEF-014 chooses Runner assignment/API wiring, UUID-to-repository binding persistence, package placement, and installation/rollback after source reinspection. AEF-002 implements explicit read/build failures and safe rebuilds; AEF-003/AEF-004 still address immutable provenance, conflicts/policies, and metadata isolation. Existing service limitations are not erased by a validated envelope.

The facade does not fetch SDK documentation, infer native client hooks, modify application files, build maps during setup planning, or claim remote publication/authentication. Validate with `npm run build`, `npm run typecheck`, `npm test`, `npm run validate:fixtures`, and `npm run smoke:mcp`. `tests/integration/application.test.ts` uses fictional isolated roots to prove contract negotiation, request authority rejection, alias handling, read-only readiness, retrieval, prepared delivery, candidate intake/replay, and output validation without SDLC Command internals or an LLM.
