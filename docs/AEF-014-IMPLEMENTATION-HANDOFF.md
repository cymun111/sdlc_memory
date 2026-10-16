# AEF-014: SDLC Command integration initiative

Prepared: 2026-10-15. Status: implementation instructions; integration is not yet implemented or verified.

## Objective

Onboard an existing Git repository into the SDLC Command workflow, with knowledge setup as the final repository-configuration step. Demonstrate this complete sequence:

1. Configure the project and bind it to a canonical knowledge repository ID.
2. Register the checkout, build its repository map, and verify discovery and scoped retrieval.
3. Start a task through actual SDLC Command with verified context consumption before planning.
4. Capture a durable learning or explicit no-learning completion.
5. List, inspect and refine a learning candidate, including stale-hash rejection.

Keep SDLC Memory standalone during the integration pilot. Decide on physical relocation only after the pilot passes. Implementation of an adapter does not, by itself, require moving the package or knowledge store.

## Workspace and authorization

Use SDLC Command as the primary workspace:

```text
C:\Users\Gaming_3.0\Documents\My_Repos\sdlccommand
```

Keep the dependency available alongside it:

```text
C:\Users\Gaming_3.0\Documents\My_Repos\sdlc_memory
```

Read the applicable `AGENTS.md` instructions in both repositories, their current requirements, and the integration references below. Verify these paths and repository identities before using them; paths alone do not authorize edits.

Before changing SDLC Command or a participating application repository, obtain explicit authorization naming that repository and the intended integration scope. The SDLC Memory agent guidance and AEF-014 acceptance criteria require this. This handoff is a plan, not that authorization. Do not ask again if the user has already provided applicable authorization in the implementation session. Synthetic disposable application fixtures may be created for tests without changing real application repositories.

Create a dedicated feature branch in each repository that actually needs changes. Suggested name: `feature/aef-014-memory-integration`. Start from the appropriate updated base, preserve unrelated working-tree edits, and keep the integration changes reviewable in separate linked PRs if both repositories change. Do not merge or relocate anything solely because this plan exists.

## Prerequisites and source of truth

Before implementation:

1. Confirm AEF-013 is merged into the intended SDLC Memory base. If it is not, create/review/merge its PR first through the normal authorized workflow, or explicitly document a reviewed dependency branch. Do not assume a merge from a conversation summary.
2. Record both repository revisions and working-tree state. Read SDLC Memory's [PRD](PRD.md) and [feature tracker](FEATURE_TRACKER.md).
3. Read the [integration contract](sdlc-command-integration.md), [repeatable onboarding](repeatable-onboarding.md), [safe capture/session behavior](safe-capture-and-sessions.md), [candidate inspection](candidate-inspection.md), and [retrieval evaluation](retrieval-evaluation.md).
4. Inspect current SDLC Command source and its actual build/test commands. The earlier source inspection in the integration contract is dated 2026-10-13; its revision, paths and line numbers are historical evidence, not current implementation instructions.
5. Confirm the selected Runner host can access the application checkout, explicit knowledge root, built service entry point and supported client. The API host may not share the Runner's filesystem.

Treat current code as authoritative. Some historical integration-contract statements predate AEF-009 through AEF-013. Verify current exported schemas and behavior rather than copying stale capability descriptions.

## Architecture boundaries

| Owner | Responsibility |
| --- | --- |
| SDLC Command | Project/team authorization, configuration UI/API, project-to-repository binding, Runner dispatch, task lifecycle, orchestration and user-visible outcomes |
| SDLC Memory | Record contracts, trusted roots/configuration, registration/maps, scope filtering, retrieval budgets/provenance, candidate persistence, inspection and review rules |
| Integration adapter | Validated requests/results, receipt correlation, error translation, lifecycle sequencing and explicit delivery verification |

Build a thin adapter over existing services. Do not duplicate ranking, policy rules, filesystem guards, idempotency or journal recovery in SDLC Command. Do not parse human-readable CLI output when a structured service or protocol operation is available.

Persist an explicit SDLC Command project UUID → canonical knowledge repository ID binding. Display names and slugs are not authorization identities. Resolve principal, team and allowed repository access from trusted receiving-system configuration and authorization; untrusted requests must not choose filesystem roots, owner privileges or principal identity.

Select in-process facade versus stdio MCP using actual Runner/runtime compatibility. Record the decision and why it fits the host. SDLC Memory requires its declared Node engine and SQLite support; do not assume the receiving process satisfies them. MCP must launch the built Node CLI directly with absolute paths and explicit root/configuration, keeping stdout protocol-clean.

## Current reusable capabilities and limits

- `dist/application/index.js` exports `KnowledgeApplication` and versioned application schemas. Setup, readiness, retrieval and capture are available. Confirm current request/output schemas before wiring them.
- `prepareDelivery` is a prepared, unconsumed result. The facade's no-learning capture acknowledgement is non-durable. Neither may be presented as verified agent consumption or durable completion.
- The separate `codex-exec-v1` session adapter provides acknowledged context and durable learning/no-learning receipts. Its verified path uses two read-only Codex processes, not a write-enabled implementation agent or native/global hook installation. Reuse or adapt this boundary without silently replacing SDLC Command's existing execution lifecycle.
- The recorded Windows client check covers Codex `0.162.0-alpha.17.2`. Reverify the version installed on the receiving Runner. Test-launcher simulations do not establish actual client compatibility.
- MCP exposes eleven tools, including `list_candidates` and `get_candidate`. These reads are owner-authorized, bounded and read-only; they do not repair writer journals or grant publication rights.
- Local trusted configuration is not an authenticated shared service. Shared HTTP authentication and deployment remain AEF-016 work. Do not expose the local facade or stdio service as an unauthenticated network endpoint.

## Implementation sequence

### 1. Reconfirm receiving-system extension points

Inspect project configuration routes/services, the repository setup checklist, Runner assignment and filesystem access, and agent start/resume/completion dispatch. Record current file references and revisions. Identify where configuration is persisted and how partial setup failures are currently represented.

Produce a short integration design before coding: selected transport, trusted identity mapping, Runner-host placement, receipt storage, configuration insertion point, and task delivery/capture strategy. Identify any capability gap that prevents real context consumption. Do not mark the feature complete if the receiving lifecycle can only write a prompt file or generate configuration.

### 2. Write and execute failing tests first

Map every acceptance criterion below to a test or external verification step. Use the receiving repository's actual test runner. Execute valid failing tests before production changes and preserve RED/GREEN checkpoints. Tests must fail because intended behavior is missing, not because fixtures, imports or dependencies are broken.

Use fictional isolated repositories and explicit fake identities. Cover service/API/Runner boundaries and relevant UI behavior. Keep real-client checks separate from mocked launcher tests. Record commands and actual outcomes for the final evidence report.

### 3. Add knowledge setup as the final configuration step

After the receiving workflow's configured prerequisites, add the knowledge setup step using the shared setup service. Persist the canonical binding and correlate SDLC Command project/setup identity with SDLC Memory's durable receipt.

The adapter must support plan, apply, status, interruption and resume. Preserve unrelated settings and distinguish at least configured, verified, degraded/failed, and resumed outcomes using schemas appropriate to the receiving system. Reuse existing Memory step states rather than inventing successful states from file existence. Registration alone, a generated descriptor or a successful map build does not prove client consumption.

Expose actionable structured failure/retry guidance. On uninstall/rollback, remove only unchanged artifacts owned by the integration. Do not delete shared indexes, knowledge, candidates, unrelated client settings or pre-existing registrations/maps.

### 4. Connect task-start and context consumption

Retrieve scoped task context on the correct host with task ID, canonical repository, source revision and budgets. Preserve indexed knowledge provenance separately from application revision.

Required-policy review or mandatory-budget failure must block planning. Optional omissions/failures must follow an explicit documented degraded-mode policy; never silently relabel them successful. Reject or explicitly restart when context/generation/source prerequisites change.

Prove the actual selected client consumed the context before planning. Correlate task, project, repo, source/indexed revisions, generation, record IDs, adapter/client version and observed delivery outcome in durable receipts. An acknowledgement from the existing standalone adapter does not automatically verify SDLC Command's separate agent invocation. If a new delivery path is required, implement and verify it explicitly.

### 5. Connect completion capture and candidate refinement

Validate structured learning/no-learning completion and retain durable outcomes. Distinguish interrupted execution, nonzero exit, malformed output and failed intake. Stable task/session-derived idempotency keys must survive retry/restart; changed content under a reused key must conflict. Preserve failed artifacts and use bounded retries.

Exercise `submit_learning` → `list_candidates` → `get_candidate` → `update_candidate` → stale-hash rejection → reinspection through the selected actual integration path. Follow all candidate Markdown pages before editing and use the full-file content hash. Confirm candidates remain excluded from published retrieval and that inspection does not grant owner approval.

### 6. Run the actual SDLC Command pilot

Use actual SDLC Command code and its real Runner/task lifecycle, with a supported authenticated client and a fictional disposable application repository. Demonstrate the complete objective sequence, including repeated setup and a resumed failure.

Record receiving-system revision, service revision, Node/client/transport versions, setup/task/session receipts, source/indexed revisions, generation, result IDs, completion outcome, candidate hash and replay result. Publish a sanitized operator walkthrough. Do not commit credentials, real project assertions, generated databases, `.runtime`, raw client logs or private local paths into evidence artifacts.

If the actual app/Runner/client cannot run, finish the independent implementation/tests, document the exact missing prerequisite and leave AEF-014 In progress or Blocked as appropriate. Simulation, standalone Memory smoke or configuration generation alone cannot satisfy this gate.

### 7. Decide packaging and physical migration after the pilot

Document how module entry points, schemas, explicit knowledge/runtime/config roots, working directories and Node versions resolve in the chosen distribution. Test invocation from unrelated directories and an isolated packaged artifact, not only a linked source checkout.

Before any authorized relocation, inventory the canonical knowledge/candidate/history store, configuration, runtime receipt ledgers/journals, onboarding/session receipts and identity bindings. Define backups, restore validation, rollback and compatibility with existing launch descriptors and clients. Use copies/disposable stores for migration tests first. Do not create two active writers or competing canonical stores.

Verify pre/post-migration parity for registration, maps, scoped retrieval/policies/provenance, candidate hashes/history, idempotent replay and durable completion. If the decision is to retain a standalone package, record that decision and its resolution/backup/rollback contract; do not claim physical migration occurred.

## Required acceptance matrix

| Scenario | Required observable result |
| --- | --- |
| Existing repository with spaced path | Correct host registration, map, discovery and scoped context; no path assumptions based on API working directory |
| Repeated setup | Existing binding/receipts reused; no duplicate registration or unrelated settings loss |
| Repository ID/alias/project binding conflict | Explicit conflict; preserve existing configuration |
| Empty knowledge | Valid explicit empty optional results; no fabricated overview or facts |
| Missing/unavailable service or unsupported Node/runtime | Visible failure with repair/resume guidance; no false verification |
| Missing/unavailable client | Configured/prepared remains distinguishable from verified/consumed |
| Policy review or mandatory budget overflow | Planning blocked with bounded follow-up references/errors |
| Source, generation or configuration drift | Explicit invalidation/recheck/restart; no silently mixed context |
| Interrupted setup/task/capture | Durable progress/failure survives restart; bounded retry preserves artifacts |
| Learning and no-learning completion | Both schema-valid and durable; real receiving lifecycle evidence |
| Replay and changed-key payload | No duplicate on identical replay; conflict for changed content under the same key |
| Candidate refinement | Authorized list/inspect/update works; stale hash rejected; candidate remains unpublished |
| Uninstall/rollback after external settings edits | Preserve unrelated and externally changed artifacts; report conflicts safely |
| Isolated packaging / unrelated working directory | Entry points, schemas, root/config resolution and protocol output remain correct |
| Chosen migration/distribution strategy | Verified preservation/parity, one canonical store, documented backup/restore and rollback |

## Validation and completion rules

For SDLC Memory code changes run `npm run build`, `npm run typecheck`, `npm test`, `npm run validate:fixtures`, and `npm run smoke:mcp`, plus meaningful feature coverage. Run `npm run evaluate:retrieval` when retrieval/context behavior changes; preserve the existing relevance oracle and report regressions. Current synthetic gates require at least 90% relevant-record coverage, 100% mandatory-policy visibility, and zero detected scope leakage/interface mismatches. Report measured values and limitations, not production-quality extrapolations.

For SDLC Command, discover and run its documented package/workspace tests, type checks, build and relevant API/Runner/UI checks. Do not assume it uses SDLC Memory's npm commands. Verify the real pilot independently of unit/integration simulations.

Mark AEF-014 Done only when current receiving-source evidence, implemented final-configuration wiring, real end-to-end client pilot, recovery/settings preservation tests, packaging/migration decision and measured gates are all recorded. Update both repositories' relevant docs and link related PRs. Keep shared authentication, protected Git publication and other remaining features accurately scoped.

## Suggested implementation-session prompt

Paste this into a new SDLC Command workspace session after filling in the authorization clause:

```text
Implement AEF-014 using the SDLC Memory handoff at
../sdlc_memory/docs/AEF-014-IMPLEMENTATION-HANDOFF.md.

Primary workspace: sdlccommand. Dependency: ../sdlc_memory.
Scope authorization: [explicitly name the repositories/files/settings this session may change].

Read applicable AGENTS.md instructions and current requirements first. Confirm the
AEF-013 dependency and receiving source revisions. Use dedicated feature branches
and test-first development with executed RED/GREEN evidence. Keep Memory standalone
during the pilot. Reuse its schemas/services, integrate knowledge setup as the final
repository-configuration step, and verify actual SDLC Command task context consumption
and durable completion with a supported real client. Preserve unrelated settings and
one canonical store. Do not mark Done from simulations or generated configuration.
Document packaging, backups, rollback and parity before any separately authorized
physical relocation. Create reviewable changes and report actual tests and limits.
```
