# SDLC Command integration feature tracker

Created: 2026-10-01
Rewritten: 2026-10-13

SDLC Memory will soon be integrated into SDLC Command. The target outcome is onboarding an existing Git repository into the SDLC Command workflow, with knowledge setup as the final repository-configuration step. Every feature below supports repeatable setup, scoped context before planning, durable capture, reviewed knowledge, or reliable operation of that integration.

Keep implementation standalone until a working local integration is verified; physical migration follows the pilot. AEF-001 records an initial read-only SDLC Command source inspection in the [integration design](sdlc-command-integration.md). Reverify its extension points, configuration format, commands, and package boundaries before wiring the adapter. This document does not claim integration exists. The [PRD](PRD.md) remains the broader V1 baseline; prioritization does not remove its requirements. See [README](../README.md) for current capabilities.

## Delivery rules and gates

- Proposed boundary: SDLC Command owns onboarding/workflow orchestration; SDLC Memory owns contracts, validation, storage, indexing, retrieval, capture, and review. Confirm against SDLC Command source.
- Start agent access with local stdio MCP. Use a versioned application facade for setup, chosen after integration discovery; reuse services rather than parsing human-facing output or duplicating logic.
- Carry canonical IDs, explicit roots, schema versions, scope/principal identity, source revisions, generations, structured errors, and durable receipts across interfaces.
- Registration/maps support navigation immediately. An approved overview is optional during onboarding; missing descriptions remain unavailable. Never fabricate registered-repository facts.
- Markdown is untrusted data; current source is authoritative. Knowledge never authorizes actions, executes record content, or overrides task/repository instructions.
- Participating repository edits require explicit authorization. Preview configuration edits, preserve unrelated settings, and uninstall only owned artifacts.
- Keep MCP stdout protocol-clean, diagnostics on stderr, and secrets/databases/runtime artifacts out of Git.
- Status: Planned, In progress, Blocked, Done, Deferred. Done requires linked implementation, reproducible verification, and limitations; partial existing behavior is not completion.
- Code changes require `npm run build`, `npm test`, and `npm run validate:fixtures`; include type checking, SDK smoke, and targeted recovery/evaluation checks as appropriate.

**Gates:** P0 establishes contracts/correctness. P1 delivers a measured local onboarding pilot; AEF-014 is the actual SDLC Command integration and migration gate. P2 completes shared V1 and broader automation. P3 improves measured performance and optional continuity. Shared V1 cannot be claimed complete before required remote/authentication/publication checks pass.

IDs are renumbered by priority at the user's explicit request. The mapping below preserves historical references. From this revision onward keep IDs stable and reorder entries instead of renumbering again. Dependencies determine execution order within a priority.

| ID | Feature | Priority | Status | Dependencies |
| --- | --- | --- | --- | --- |
| AEF-001 | Versioned SDLC Command integration contract | P0 | Done | None |
| AEF-002 | Explicit failures and safe index rebuilds | P0 | Done | AEF-001 |
| AEF-003 | Snapshot provenance and drift reporting | P0 | Done | AEF-001, AEF-002 |
| AEF-004 | Conflict visibility, policies, and response isolation | P0 | Done | AEF-001, AEF-003 |
| AEF-005 | Multi-repository retrieval evaluation | P1 | Done (baseline; quality gap visible) | AEF-002 through AEF-004 |
| AEF-006 | Repository discovery through MCP | P1 | Done | Existing local configuration |
| AEF-007 | Evidence-backed repository maps | P1 | Done | AEF-006 |
| AEF-008 | Repeatable onboarding and readiness receipts | P1 | Done (local manual stdio) | AEF-001 through AEF-004, AEF-006, AEF-007 |
| AEF-009 | Deterministic task matching and ranking | P1 | Planned | AEF-005 |
| AEF-010 | Progressive retrieval and complete budgets | P1 | Planned | AEF-003, AEF-004, AEF-005 |
| AEF-011 | Safe candidate persistence and recovery | P1 | Planned | AEF-001, AEF-002 |
| AEF-012 | Verified task context and completion capture | P1 | Planned | AEF-008, AEF-010, AEF-011 |
| AEF-013 | Candidate inspection through MCP | P1 | Planned | AEF-001, AEF-011 |
| AEF-014 | SDLC Command integration and migration gate | P1 | Planned | AEF-005 through AEF-013 |
| AEF-015 | Governed Git publication and lifecycle | P2 | Planned | AEF-004, AEF-011, AEF-013 |
| AEF-016 | Authenticated shared service and operations | P2 | Planned | AEF-001 through AEF-004, AEF-011, AEF-015 |
| AEF-017 | Automatic freshness and merged-artifact capture | P2 | Planned | AEF-003, AEF-012, AEF-015, AEF-016 |
| AEF-018 | Cross-repository dependency/impact traversal | P2 | Planned | AEF-004, AEF-005, AEF-007, AEF-017 |
| AEF-019 | Incremental indexing and retrieval caching | P3 | Planned | AEF-003, AEF-005, AEF-017 |
| AEF-020 | Optional resumable session handoffs | P3 | Planned | AEF-011, AEF-012, AEF-014 |

### Historical ID mapping

| Previous ID | Feature | Current ID |
| --- | --- | --- |
| AEF-001 | Repository discovery | AEF-006 |
| AEF-002 | Repository maps | AEF-007 |
| AEF-003 | Task ranking | AEF-009 |
| AEF-004 | Cross-repository traversal | AEF-018 |
| AEF-005 | Progressive retrieval | AEF-010 |
| AEF-006 | Automatic freshness | AEF-017; expanded with merged-artifact capture |
| AEF-007 | Incremental indexing/caching | AEF-019 |
| AEF-008 | Candidate inspection | AEF-013 |
| AEF-009 | Task-start delivery | AEF-012; expanded with completion capture |
| AEF-010 | Retrieval evaluation | AEF-005 |

## AEF-001: Versioned SDLC Command integration contract

**Priority / status:** P0 / Done for the additive local contract/facade.
**Outcome:** A stable interface survives integration and later packaging changes.

**Acceptance criteria:**

- Inspect SDLC Command configuration/task lifecycle and document entry points, repository identity, and configuration ownership with source references; unresolved choices remain explicit.
- Define bounded, schema-validated setup, readiness, retrieval, delivery, and capture contracts with versions and operation-specific outputs.
- Specify ID/alias resolution, roots, principal/scopes, supported transport, errors, retryability, and compatibility. Unsupported versions fail before mutation.
- A fictional consumer exercises the facade without SDLC Command internals or an LLM dependency; existing CLI/MCP compatibility is preserved or explicitly migrated.

**Implementation details:** Inventory `src/core/config.ts`, `src/cli.ts`, `src/mcp/server.ts`, `src/mcp/tools/contracts.ts`, and `schemas/`. Extract a small application facade and thin adapters. Replace generic output envelopes incrementally. Document a plan/apply configuration boundary; routing labels are not authentication.

**Integration contribution:** Defines what SDLC Command calls during final configuration and later workflow events.

**Completion scope:** [Integration contract and source inspection](sdlc-command-integration.md), [versioned schemas](../src/application/contracts.ts), [facade](../src/application/service.ts), and [fictional consumer tests](../tests/integration/application.test.ts). Setup apply, client consumption, durable no-learning receipts, and actual SDLC Command wiring remain AEF-008/AEF-012/AEF-014. The legacy CLI/MCP API remains unchanged.

## AEF-002: Explicit failures and safe index rebuilds

**Priority / status:** P0 / Done for local failure semantics and controlled rebuild recovery.
**Outcome:** Empty results cannot conceal failed retrieval or incomplete indexing.

**Acceptance criteria:**

- Distinguish successful empty results from unavailable/corrupt indexes, FTS failures, unreadable directories, and incomplete knowledge.
- Required-directory failures cannot replace the active index with a successful empty build; optional-directory semantics are documented.
- Invalid records, duplicate IDs, unresolved references, invalid edges, and forbidden supersession cycles prevent switching.
- Failed/interrupted builds preserve the last good generation, expose degraded status, and avoid unauthorized path disclosure.
- Fault tests exercise service and actual MCP paths for reads, parsing, queries, staging, and generation switching.

**Implementation details:** Replace broad error suppression in `findRecords()` in `src/indexing/build-index.ts` and task retrieval in `src/retrieval/service.ts`. Introduce structured errors, bounded public diagnostics, staging completeness validation, and safe abandoned-staging cleanup.

**Integration contribution:** Supports accurate onboarding failure and retry/degradation reporting.

**Completion scope:** Read-only existing-generation reads; sanitized missing-index/query errors; validated records, references and supersession; last-good preservation; schema-validated build status; current-attempt cleanup; CLI validation and SDK/stdio verification. See [test-first evidence](aef-002-tdd.md) and [operations](operations.md). Hard-kill/power-loss durability, concurrent-writer recovery, and historical artifact sweeping are not claimed.

## AEF-003: Snapshot provenance and drift reporting

**Priority / status:** P0 / Done for local immutable snapshots and moment-in-time drift reporting.
**Outcome:** Responses identify the knowledge snapshot actually queried.

**Acceptance criteria:**

- Persist commit, generation, schema/indexer versions, build time, counts, and deterministic content fingerprint in the index manifest.
- Advancing checkout HEAD without rebuilding does not change indexed revision; return checkout drift separately.
- Dirty/unversioned builds are labeled and fingerprinted. Detect concurrent build-source changes and reject/retry or prove snapshot consistency.
- Responses/receipts distinguish indexed knowledge revision from each application repository's source revision.
- Tests cover historical revisions, uncommitted edits, rebuilds, unavailable Git metadata, and index/checkout disagreement.

**Implementation details:** Extend manifest schemas and read immutable provenance from the database instead of live HEAD in `manifest()`. Define normalized hashing/order and rebuild behavior for existing indexes.

**Integration contribution:** Attaches accurate evidence to SDLC Command setup/task receipts.

**Completion scope:** Versioned stored manifests, normalized content/schema hashes, honest clean/dirty/unversioned/unavailable labels, captured-byte validation and change detection, public metadata without global counts, scoped application revisions, discovery/map/facade/CLI/session metadata, and explicit legacy rebuild behavior. See [snapshot semantics](snapshot-provenance.md) and [TDD evidence](aef-003-tdd.md). Continuous freshness, source locking, measured latency and shared concurrency guarantees remain follow-ups.

## AEF-004: Conflict visibility, policies, and response isolation

**Priority / status:** P0 / Done for local conflict/policy gates and structural projection.
**Outcome:** Required policies and conflicts remain explicit without exposing inaccessible metadata.

**Acceptance criteria:**

- Return relevant authorized conflict reports/contradictory records rather than a constant empty conflict list.
- Disputed/superseded records are non-normative; authorized historical inspection is separate from default retrieval.
- Stale mandatory policies produce explicit revalidation/blocking under documented rules, never silent disappearance or fresh-compliance claims.
- Policy overflow returns `CONTEXT_BUDGET_EXCEEDED` with bounded references.
- Filter relationship targets, source metadata, titles, counts, and conflicts before serialization; test hidden targets, conflicting scopes, unknown/stale policies, and overflow.

**Implementation details:** Connect capture/review conflict state to retrieval. Audit raw `summary()` relationships/evidence. Define reviewed resolution and applicability; approval evidence and freshness are separate.

**Integration contribution:** Supplies explicit continue, review, or block outcomes for planning.

**Completion scope:** Authorized report/curated contradiction visibility; non-normative history; stale/disputed/unknown/approval/review-date blockers; bounded follow-up references and conflict traversal; projected metadata/record headers; owner-only expected-hash report review; permission and linked-write guards; CLI and SDK stdio verification. See [semantics](conflicts-and-policies.md) and [TDD evidence](aef-004-tdd.md). Arbitrary prose classification, shared authentication, remote approval verification, protected-branch publication and comprehensive crash recovery remain follow-ups.

## AEF-005: Multi-repository retrieval evaluation

**Priority / status:** P1 / Done for the versioned local baseline; 90% relevant-record target unmet.
**Outcome:** Retrieval quality and efficiency have reproducible evidence.

**Acceptance criteria:**

- Add at least 30 annotated fictional tasks across unrelated repositories and curated dependencies, including expected records/policies, denied scopes, stale evidence, conflicts, empty results, and failures.
- Measure coverage, mandatory-policy recall, stale results, unauthorized exposure, calls, bytes, estimated tokens, and latency.
- Establish strict-term baseline before ranking changes; compare identical tasks with full-document retrieval and report per-case regressions.
- Evaluate PRD targets of 100% mandatory-policy recall and at least 90% relevant-record coverage; unmet targets stay visible.
- Publish a reproducible command, fixture version, environment, raw results, and limitations; no invented performance claims.

**Implementation details:** Replace placeholder-only evaluation under `tests/retrieval/` with versioned fixtures/evaluator. Separate deterministic CI gates from hardware-dependent timings; exercise real service/MCP paths.

**Completion scope:** [36 annotated tasks](../tests/retrieval/fixtures/v1.json) exercise fictional unrelated repositories, curated dependencies, denied metadata, stale/disputed policies, conflicts, empty results and failures through real service/SDK paths. `npm run evaluate:retrieval` writes raw envelopes and per-case measurements. The [method/results](retrieval-evaluation.md) and [TDD evidence](aef-005-tdd.md) document the strict-term baseline and full-document comparison: 29/34 relevant pairs (85.29%, below target), 54/54 mandatory-policy references (100%, including explicit blockers), zero detected unauthorized exposure and zero interface mismatches. Deterministic baseline changes fail CI; latency has no hardware-dependent threshold. AEF-009/010 must close the four documented matching gaps before the missing quality target can be claimed. No production workload or SDLC Command integration is established.

**Integration contribution:** Provides measurable onboarding/task-context acceptance gates.

## AEF-006: Repository discovery through MCP

**Priority / status:** P1 / Done for existing local scope.
**Outcome:** Agents discover authorized canonical repository IDs.

**Acceptance criteria covered by existing implementation:**

- Bounded paginated discovery validates input/output and matches CLI behavior.
- Descriptions derive from indexed approved overviews/evidence; absent descriptions remain unavailable.
- Unauthorized metadata is excluded and fixtures are not asserted as real registered-application facts.
- Integration/SDK tests cover filtering, pagination, unrelated fictional repositories, and scope denial.

**Implementation details:** Reuse `src/retrieval/repositories.ts`, discovery integration tests, and `scripts/smoke-mcp.ts`. See [discovery documentation](repository-discovery.md). Existing access is a local allowlist and live freshness is unchecked; additional provenance/auth belongs to AEF-003/AEF-016. Preserve regression guarantees.

**Integration contribution:** Supplies repository selection and task identity routing.

## AEF-007: Evidence-backed repository maps

**Priority / status:** P1 / Done for existing Git/npm scope.
**Outcome:** Agents navigate committed files, packages, declared entry points, commands, and tests.

**Acceptance criteria covered by existing implementation:**

- Explicit build/read uses validated contracts with commits, relative paths, and blob hashes.
- Bounded summary/pagination is tested across fictional layouts with CLI/MCP parity.
- Selected sensitive/generated paths are excluded; scripts are not executed and source checkouts remain unchanged.
- Flags identify changed HEAD, dirty worktrees, and unavailable sources.

**Implementation details:** Reuse `src/retrieval/repository-map.ts`, map schema/tests, and [map documentation](repository-maps.md). Maps are ignored runtime artifacts. Generic Git/npm only; explicit rebuild; no symbols, inferred responsibilities, or call graph. Automatic refresh belongs to AEF-017.

**Boundary hardening (2026-10-13):** Cached item/evidence paths now enforce normalized relative paths and extraction exclusions before serialization. Existing linked runtime/map-directory ancestors are rejected before creation/write; linked/nonregular cache files are rejected on read. [Test-first evidence](aef-007-tdd.md) records eight RED→GREEN integration cases, including a native source-write guard, 145 passing tests on this branch, required build/typecheck/fixture/stdio checks, and map coverage above 80% in every category. CLI/MCP fields remain compatible for SDLC Command onboarding. Concurrent filesystem replacement, cache authenticity and general secret classification are not claimed.

**Integration contribution:** Provides initial navigation without an invented overview.

## AEF-008: Repeatable onboarding and readiness receipts

**Priority / status:** P1 / Done for local manual stdio setup; native adapters/edits and task consumption remain unverified.
**Outcome:** Knowledge setup is a resumable final configuration operation.

**Acceptance criteria:**

- Validate Git root, canonical ID, owner/team, knowledge/runtime roots, and connection mode before mutation.
- Record registration, map build, index readiness, tool discovery, and scoped-read verification separately.
- Identical reruns reuse setup; changed inputs invalidate affected steps; ID/path conflicts never silently rebind repositories.
- Distinguish configured, service verified, context delivery verified, degraded, and failed; generated configuration is not verification.
- Missing knowledge/overviews remain unavailable. Failure preserves settings and durable receipts with retry guidance; uninstall removes only owned artifacts.
- Test Windows/spaced paths, wrong roots, dirty checkouts, reruns, changed settings, partial failures, and missing clients.

**Implementation details:** Compose registration/discovery/map/doctor services behind the facade, independent of CLI parsing. Store fingerprints, step states, revisions/generations, and sanitized diagnostics in ignored runtime storage. Preview authorized client edits.

**Completion scope:** [Facade-backed setup](../src/onboarding/service.ts) and CLI `setup plan|apply|status|uninstall` validate separate canonical Git/knowledge/runtime roots before mutation, persist six resumable step states, generate a manual launch preview, and verify nine-tool discovery/scoped reads with actual stdio SDK clients. Readiness exposes the durable receipt and later drift; uninstall preserves unrelated/pre-existing settings and rejects linked deletion paths. [Operations/limits](repeatable-onboarding.md) and [test-first evidence](aef-008-tdd.md) document 27 synthetic integration/CLI/SDK cases and executed RED/GREEN checkpoints. Manual descriptor completion is distinct from service verification; `context_delivery_verified` remains false. Selected native adapters report degraded/unavailable and edit no external files. AEF-014 still owns receiving-system integration, and AEF-012 owns actual task delivery.

**Integration contribution:** Main operation called after SDLC Command's other setup steps.

## AEF-009: Deterministic task matching and ranking

**Priority / status:** P1 / Planned.
**Outcome:** Natural-language tasks match useful records without all terms occurring.

**Acceptance criteria:**

- Support weighted alternatives, exact tags/paths, and explicitly recorded symbols without implying automatic symbol extraction.
- Keep task text, topics, and paths as distinct signals rather than one strict `AND` query.
- Document weights, scope specificity, freshness influence, stable tie-breaking, and meaningful matched reasons.
- Preserve access-before-ranking, policy handling, graph limits, and budgets.
- Compare AEF-005 baseline/results against PRD quality gates and disclose regressions/leakage failures.

**Implementation details:** Refactor retrieval tokenization/FTS ranking; add normalized derived tags/source metadata. Bound terms/candidates, parameterize SQL, and avoid runtime LLM reranking/embeddings.

**Integration contribution:** Makes SDLC Command task descriptions effective retrieval inputs.

## AEF-010: Progressive retrieval and complete budgets

**Priority / status:** P1 / Planned.
**Outcome:** Summaries precede focused expansion within reliable limits.

**Acceptance criteria:**

- Summary/read/expansion includes stable references, scopes, evidence, freshness, and generation.
- Expansion serves the exact retained generation or explicitly rejects drift; no silently mixed snapshots.
- Bound complete serialized envelopes by bytes/tokens, results, visits/depth, and pagination, including metadata.
- Required policy omission returns explicit budget failure; document behavior when the minimum error envelope exceeds caller budgets.
- UTF-8 truncation stays valid and offers explicit follow-up. Test tiny budgets, large evidence, multibyte bodies, and cursor drift.
- Compare completeness/response size to full-document retrieval.

**Implementation details:** Extend existing summary-first retrieval and centralize final serialization accounting. Bind cursors/expansion to generation, normalized request, and access context. Retain labeled conservative estimates.

**Integration contribution:** Controls task context and targeted follow-up reads.

## AEF-011: Safe candidate persistence and recovery

**Priority / status:** P1 / Planned.
**Outcome:** Automatic intake is safe, durable, and recoverable.

**Acceptance criteria:**

- Enforce schema and UTF-8 byte limits across CLI/MCP/session/future HTTP before writes.
- Screen recognizable credentials/private keys with sanitized diagnostics; document false positives and screening limits.
- Validate canonical roots/regular files for candidates, archives, publication, and runtime storage; test symlink/junction escapes and replacement races where supported.
- Fault-inject submission/update/publication/rejection file-ledger boundaries. Restart reconciles state without overwriting unrelated edits or false success.
- Concurrent writes preserve idempotency and optimistic hashes; changed content under the same key conflicts.
- Preserve required rejection/candidate history in the Git-authoritative lifecycle; generated ledgers stay uncommitted.

**Implementation details:** Extend update journaling in candidate-store/review services to uncovered transitions. Centralize safe bounded I/O/secret checks and add concurrent-process/failure tests.

**Integration contribution:** Protects retryable SDLC Command learning capture.

## AEF-012: Verified task context and completion capture

**Priority / status:** P1 / Planned.
**Outcome:** A supported agent consumes context before planning and emits a durable completion.

**Acceptance criteria:**

- Verify at least one real client/adapter/version/transport; test-launcher plumbing evidence is labeled separately.
- Demonstrate context consumption before planning, not merely writing a file/prompt.
- Receipts include task/repo, source/indexed revisions, generation, IDs, adapter version, and actual delivery outcome.
- Required-policy failure blocks planning; optional failure is explicitly degraded under documented rules.
- Schema-validate learning/no-learning artifacts; distinguish interruption, malformed output, nonzero exit, and failed intake.
- Replay produces no duplicate; restart and bounded retries preserve failures. Installation/removal preserves unrelated settings and verifies Windows launch behavior.

**Implementation details:** Extend `src/capture/session.ts`, implement selected hook handlers and installer, and version completion schemas/state transitions. Other client integrations remain unverified until separately checked.

**Integration contribution:** Connects task-start/completion events to retrieval/intake.

## AEF-013: Candidate inspection through MCP

**Priority / status:** P1 / Planned.
**Outcome:** Agents obtain content/current hashes before editing learnings.

**Acceptance criteria:**

- Implement bounded `list_candidates`/`get_candidate` with validated operation outputs and read-only annotations.
- Return authorized metadata/state/hash/bounded Markdown without absolute local paths or hidden counts.
- Pagination signals concurrent changes or uses stable listing state.
- Actual SDK tests prove submit -> list -> inspect -> update -> stale-hash rejection -> reinspection.
- Inspection grants no approval rights and never exposes candidates in published retrieval.

**Implementation details:** Adapt existing list/inspect services with limits, access checks, safe reads, and public response mapping; extend SDK smoke and editing docs.

**Integration contribution:** Enables in-workflow refinement and review preparation.

## AEF-014: SDLC Command integration and migration gate

**Priority / status:** P1 / Planned.
**Outcome:** An existing repository completes real SDLC Command onboarding and starts an informed task.

**Acceptance criteria:**

- Confirm interface/configuration insertion point against actual SDLC Command source with evidence.
- Integrate knowledge setup as final configuration with resumable receipts and configured-versus-verified state.
- Verify registration -> map -> discovery -> scoped retrieval -> consumed context -> submission -> inspection/update on fictional repositories.
- Test repeated setup, ID conflicts, spaces, empty knowledge, drift, missing service/client, interruption, and resume without settings loss.
- Demonstrate actual SDLC Command plus a supported real client; simulation alone cannot mark Done.
- Before relocation, document package/root/schema resolution, preserved data/receipts, backups, rollback, and compatibility; verify pre/post-migration parity and one canonical store.
- Record measured retrieval gates and limitations. Obtain explicit authorization for external repository changes.

**Implementation details:** Build a thin facade/MCP adapter. Choose package placement after pilot; test unrelated working directories and packaged schemas. Publish an operator walkthrough with external verification evidence.

**Integration contribution:** Completion gate for onboarding and physical migration.

## AEF-015: Governed Git publication and lifecycle

**Priority / status:** P2 / Planned.
**Outcome:** Review/publication/history become durable Git-authoritative changes.

**Acceptance criteria:**

- Shared publication uses isolated branches/PRs, stable IDs, and verification/approval evidence.
- Policies/decisions require owner approval evidence; observed facts require registered code evidence, not path existence alone.
- Preserve rejection reasons, disputes, and superseded history in versioned records, not only runtime archives.
- Validate references/acyclic supersession and reviewed conflict resolution.
- Serialize writes with bounded push/rebase retries; pending work survives failure and receipts never claim merged publication prematurely.
- Verify CODEOWNERS/branch protection independently of CI; remote tests use authorized repositories/credentials and simulations are labeled.

**Implementation details:** Add Git writer/publication states around local review; distinguish dirty-worktree approval from protected-branch merge. Implement PRD normalized-claim deduplication/near-match suggestions while preserving new evidence.

**Integration contribution:** Gives accurate review/merged/rejected/superseded workflow states.

## AEF-016: Authenticated shared service and operations

**Priority / status:** P2 / Planned.
**Outcome:** Teams use one durable authorized service.

**Acceptance criteria:**

- Implement authenticated HTTP MCP, CI capture, readiness/liveness, and refresh with server-derived identity/scopes.
- Verify isolation across all tools/metadata; caller-supplied IDs cannot grant access.
- Use one canonical checkout, persistent storage, and serialized writer; test restart, backup/restore, rotation/revocation.
- Test/document loopback defaults, TLS proxy, credentials, and private health details.
- Audit writes/denials/refresh/publication without secrets or unnecessary payloads.
- Actual SDK tests verify HTTP separately from stdio; generated config establishes no compatibility claim.

**Implementation details:** Add auth/transport/audit adapters over shared services; complete deployment scaffolds, config/principal validation, volume/monitoring/readiness documentation.

**Integration contribution:** Enables team deployments after local integration.

## AEF-017: Automatic freshness and merged-artifact capture

**Priority / status:** P2 / Planned.
**Outcome:** Source changes trigger revalidation and explicit merged artifacts reach intake.

**Acceptance criteria:**

- Compare cited blobs/commits to repository-specific revisions/worktrees with fresh/stale/dirty/unavailable/unchecked states.
- Handle rename/delete/edit/missing history without claiming semantic correctness or rewriting approval.
- Process source changes without artifacts and refresh affected maps through a bounded configured mechanism.
- Protected-branch CI binds artifacts to merged commits and authenticated registered identity with stable idempotency keys.
- Visible retries do not break application deployment; deleted artifacts do not delete published knowledge.
- Verify handlers, restart/retry recovery, and real authorized remote capture separately from simulations.

**Implementation details:** Implement source-change/maintenance handlers, evidence indexing, and GitHub capture workflow beyond scaffolding. Scope revisions per repository, batch repeated Git checks, and keep scheduler receipts in runtime storage.

**Integration contribution:** Maintains onboarded repositories and merged-workflow learnings.

## AEF-018: Cross-repository dependency/impact traversal

**Priority / status:** P2 / Planned.
**Outcome:** Planning identifies affected producers, consumers, owners, and contracts.

**Acceptance criteria:**

- Validate directed evidence-backed repository/contract edges; registration alone infers no dependency.
- Bound traversal with cycles/filters/depth/results, stable ordering, and explanations.
- Filter inaccessible nodes/edges/evidence/counts before traversal/serialization.
- Label stale/missing evidence and curated versus extracted links.
- Evaluate fictional producer/consumer changes and hidden intermediate nodes without hidden-path disclosure.

**Implementation details:** Extend graph nodes to repositories/contracts, reuse bounded traversal, and document incoming/outgoing semantics with evaluation fixtures.

**Integration contribution:** Supports cross-repository change-impact planning.

## AEF-019: Incremental indexing and retrieval caching

**Priority / status:** P3 / Planned.
**Outcome:** Repeated work costs less without changing correctness.

**Acceptance criteria:**

- Full/incremental logical parity covers additions/edits/renames/deletes/edges/lifecycle.
- Failed/concurrent updates preserve last-good index; cleanup respects active readers.
- Cache keys bind normalized request, authorization, policies/conflicts, source freshness, budgets, and generation.
- Test invalidation after publication/source edits/revocation/budget changes; no cross-scope reuse.
- Publish measured cold/warm latency/resources against AEF-005 and claim only demonstrated gains.

**Implementation details:** Use ID/content hashes in staging updates; retain full rebuild as reference/recovery. Bound cache lifetime/capacity and recheck dirty-worktree freshness unless fingerprinted.

**Integration contribution:** Reduces setup/task overhead after reliability is established.

## AEF-020: Optional resumable session handoffs

**Priority / status:** P3 / Planned; optional beyond required durable-knowledge V1.
**Outcome:** Later sessions resume transient work without presenting it as published knowledge.

**Acceptance criteria:**

- Separate schema covers objective, observed state, evidence/tests, source revision, remaining work, blockers, and next action.
- Distinguish intent, attempts, and verified results; handoffs cannot authorize actions or become policy.
- Exclude from default published retrieval and define explicit scope/retention/cleanup.
- Preserve corrections/history, flag stale references, and enforce access/byte/secret/path checks.
- Demonstrate interrupted fictional-task resume through another supported path without duplicate capture.

**Implementation details:** Reuse session receipts/structured artifacts; store separately in ignored runtime storage unless reviewed sharing is selected. No raw transcript import or runtime LLM dependency.

**Integration contribution:** Enables pause/resume and agent handoffs after onboarding works.

## Completion evidence

Historical evidence is preserved from the previous tracker and establishes local feature scope only. AEF-001 completion establishes the additive integration contract, not the receiving-system integration.

| Current ID | Previous ID | Completion date | Implementation | Verification | Limitations |
| --- | --- | --- | --- | --- | --- |
| AEF-001 | New | 2026-10-13 | [Schemas/facade](../src/application/index.ts), [integration design](sdlc-command-integration.md) | [Consumer tests](../tests/integration/application.test.ts); build, typecheck, tests, fixtures, and MCP smoke | Local contract only; plan-only setup; delivery unconsumed; no-learning acknowledgement non-durable; broader service correctness work remains planned |
| AEF-002 | New | 2026-10-13 | [Index builder](../src/indexing/build-index.ts), [reader](../src/indexing/database.ts), [graph validation](../src/validation/graph.ts), retrieval/facade | [TDD checkpoints and results](aef-002-tdd.md); 68 tests, build/typecheck/fixtures/SDK stdio passed; feature coverage gates passed | Local controlled failure recovery; best-effort status; hard-kill/power-loss and concurrent-writer recovery remain follow-ups |
| AEF-003 | New | 2026-10-13 | [Provenance schemas/services](../src/indexing/provenance.ts), indexing, retrieval, facade/CLI/receipts | [TDD checkpoints](aef-003-tdd.md); 88 tests, build/typecheck/fixtures/SDK smoke passed; provenance and indexing/graph coverage gates passed | Legacy indexes require full rebuild; live drift is moment-in-time; no source locking or continuous freshness; no receiving-system wiring |
| AEF-004 | New | 2026-10-13 | [Visibility projection](../src/retrieval/visibility.ts), [conflict review](../src/capture/conflicts.ts), retrieval/CLI/MCP contracts | [TDD checkpoints](aef-004-tdd.md); 125 tests, build/typecheck/fixtures/SDK stdio and targeted coverage gates passed | Local owner worktree review; declared approval shape only; known structural metadata projection; no shared ACL/protected publication/native-agent integration |
| AEF-005 | New | 2026-10-13 | [Evaluator](../scripts/retrieval-evaluation.ts), [versioned tasks](../tests/retrieval/fixtures/v1.json), [per-case measurements](evaluations/aef-005-v1-results.json) | [TDD checkpoints](aef-005-tdd.md); 137 tests, build/typecheck/fixtures/SDK stdio passed; scoped evaluator coverage exceeds 80% in every category | 85.29% relevant coverage remains below target; 100% policy visibility includes blockers; fictional corpus and SDK in-memory transport, no production/native-agent/SDLC Command readiness claim |
| AEF-006 | AEF-001 | 2026-10-01 | [Discovery service](../src/retrieval/repositories.ts), MCP/CLI | [Discovery tests](../tests/integration/repositories.test.ts), [SDK smoke](../scripts/smoke-mcp.ts); prior tracker records build, typecheck, 30 tests, fixtures, and smoke passing | Local allowlist; live freshness unchecked; SDLC Command integration unverified |
| AEF-007 | AEF-002 | 2026-10-13 | [Map service](../src/retrieval/repository-map.ts), [schema](../schemas/repository-map.schema.json), filesystem guards, MCP/CLI | [Map tests](../tests/integration/repository-map.test.ts), [TDD checkpoints](aef-007-tdd.md), [SDK smoke](../scripts/smoke-mcp.ts); 145 tests, build/typecheck/fixtures/stdio and scoped coverage passed | Git/npm only; explicit rebuild; no symbols/call graph; trusted runtime roots, no concurrent filesystem replacement protection; unmerged AEF-006 excluded from totals; integration unverified |
| AEF-008 | New | 2026-10-13 | [Onboarding service](../src/onboarding/service.ts), [contracts](../src/onboarding/contracts.ts), facade/readiness and CLI | [TDD checkpoints](aef-008-tdd.md), [27 onboarding cases](../tests/integration/onboarding.test.ts); 172 tests, build/typecheck/fixtures/stdio and scoped coverage gates passed | Manual local stdio only; no native-client edits/context consumption/receiving-system wiring; includes pending AEF-007 and excludes separate unmerged AEF-006 |

For each completion add implementation/test links, verification date/commands, measured results where applicable, client/transport versions, and limitations. External checks remain explicit blockers; documentation/configuration generation is not completion evidence.
