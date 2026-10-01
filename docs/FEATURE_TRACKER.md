# Agent efficiency feature tracker

Tracks proposed improvements for agents working across unrelated codebases. These entries are planned work, not claims of implemented behavior. See [README](../README.md) for current capabilities and [PRD](PRD.md) for broader requirements.

Created: 2026-10-01

Feature IDs are permanent. Never renumber or reuse an ID; assign the next unused `AEF-NNN` identifier to new work. Status values: Planned, In progress, Blocked, Done, Deferred. Mark Done only with implementation and verification evidence.

| Feature ID | Feature | Priority | Status | Dependencies |
| --- | --- | --- | --- | --- |
| AEF-001 | Repository discovery through MCP | P1 | Done | None |
| AEF-002 | Evidence-backed repository maps | P1 | Done | AEF-001 |
| AEF-003 | Improved task matching and ranking | P1 | Planned | None |
| AEF-004 | Cross-repository dependency traversal | P2 | Planned | AEF-001, AEF-002 |
| AEF-005 | Progressive context retrieval | P2 | Planned | AEF-002, AEF-003 |
| AEF-006 | Automatic source freshness checks | P2 | Planned | None |
| AEF-007 | Incremental indexing and retrieval caching | P3 | Planned | AEF-006 |
| AEF-008 | Candidate inspection through MCP | P2 | Planned | None |
| AEF-009 | Verified task-start context delivery | P2 | Planned | AEF-005 |
| AEF-010 | Multi-repository retrieval evaluation | P1 | Planned | None; extend as other features land |

P1 establishes navigation and a measurement baseline; P2 expands workflows and reliability; P3 optimizes performance after correctness is measured. Dependencies describe this proposed delivery order, not existing implementation guarantees.

## AEF-001 — Repository discovery through MCP

**Outcome:** An agent can identify relevant authorized repositories without knowing their IDs in advance.

**Completion criteria:**
- Expose a bounded, paginated discovery tool using registered repository identities.
- Return evidence-backed overview descriptions; label unavailable metadata. Per the approved implementation scope, structured languages and entry points are deferred to AEF-002.
- Filter unauthorized repository metadata before producing results.
- Test discovery with multiple fictional, unrelated repositories and restricted access.

## AEF-002 — Evidence-backed repository maps

**Outcome:** Agents locate package boundaries, entry points, tests, and development commands without repeatedly exploring entire trees. Per the approved scope, symbol indexing and inferred module responsibilities are deferred.

**Completion criteria:**
- Define and validate a compact map contract with repository-relative paths and source revisions.
- Implement an explicit map generation/update workflow; distinguish extracted facts from inferred descriptions.
- Exclude credentials, generated files, and paths outside registered roots.
- Detect stale map evidence and demonstrate useful navigation across different repository layouts.

## AEF-003 — Improved task matching and ranking

**Outcome:** Natural-language tasks find useful records even when not every query term appears in a record.

**Completion criteria:**
- Add deterministic matching for keyword alternatives, exact symbols/paths, and tags.
- Document ranking weights, stable tie-breaking, and matched reasons.
- Apply authorization before ranking and preserve mandatory-policy handling and response budgets.
- Compare against the current strict-term baseline using AEF-010 fixtures; record regressions as well as gains.

## AEF-004 — Cross-repository dependency traversal

**Outcome:** Agents identify owners, consumers, contracts, and potentially affected repositories before changing code.

**Completion criteria:**
- Define typed, evidence-backed repository and contract relationships with direction and revision information.
- Support bounded impact traversal with cycle handling, depth limits, and explanations for returned links.
- Prevent inaccessible repository names, paths, and relationships from leaking through traversal.
- Test a fictional producer/consumer change and label missing or stale dependency evidence.

## AEF-005 — Progressive context retrieval

**Outcome:** Agents receive small summaries and file pointers first, then expand only relevant material.

**Completion criteria:**
- Define summary and expansion contracts with stable record references and generation metadata.
- Bound serialized response bytes, estimated tokens, graph traversal, and pagination.
- Preserve mandatory policy visibility or return an explicit budget error.
- Measure response size and retrieval completeness against full-document retrieval.

## AEF-006 — Automatic source freshness checks

**Outcome:** Agents can distinguish reusable knowledge from claims that need source reinspection.

**Completion criteria:**
- Compare cited source evidence with registered repository revisions and relevant working-tree changes.
- Handle edits, renames, deletions, unavailable revisions, and rewritten history with a documented fallback.
- Trigger checks when sources change, including changes with no learning artifact.
- Report freshness without silently rewriting approved records or claiming that path existence proves correctness.

## AEF-007 — Incremental indexing and retrieval caching

**Outcome:** Repeated tasks and small knowledge changes require less indexing and retrieval work.

**Completion criteria:**
- Demonstrate full/incremental index parity for additions, edits, renames, deletions, and relationships.
- Preserve the last good index on failed updates.
- Key cached results by normalized request, authorization context, source revisions, budgets, and index generation.
- Verify invalidation and scope isolation; report measured latency and resource use.

## AEF-008 — Candidate inspection through MCP

**Outcome:** Agents can inspect pending learnings and obtain current hashes before calling `update_candidate` without terminal access.

**Completion criteria:**
- Implement `list_candidates` and `get_candidate` with validated inputs and outputs.
- Return authorized candidate metadata, bounded Markdown, and current content hashes.
- Support bounded listing and clearly distinguish candidates from published knowledge.
- Test submission → inspection → update → stale-hash conflict through an actual MCP client.

## AEF-009 — Verified task-start context delivery

**Outcome:** Relevant knowledge reaches the agent before planning on each supported task path.

**Completion criteria:**
- Implement and document at least one supported native hook or launcher path.
- Demonstrate context consumption by the agent or test launcher; writing a file alone is insufficient.
- Record repository, task, revision, generation, and result IDs in a delivery receipt.
- Test optional-retrieval degradation and required-policy blocking; preserve existing configuration during installation and removal.

## AEF-010 — Multi-repository retrieval evaluation

**Outcome:** Efficiency improvements are evaluated against repeatable correctness and performance measurements.

**Completion criteria:**
- Create at least 30 annotated tasks spanning fictional unrelated repositories and cross-repository dependencies.
- Include expected relevant records, mandatory policies, inaccessible scopes, stale evidence, and empty-result cases.
- Measure coverage, policy recall, stale results, tool calls, response bytes, estimated tokens, and latency.
- Establish a baseline before ranking changes and publish reproducible commands, hardware, results, and limitations.
- Use PRD retrieval targets where applicable; do not claim token savings or performance gains without measurements.

## Completion evidence

Add one row when a feature reaches Done. Link implementation, tests/evaluation results, and any remaining limitations.

| Feature ID | Completion date | Implementation reference | Verification evidence | Limitations |
| --- | --- | --- | --- | --- |
| AEF-001 | 2026-10-01 | [Discovery service](../src/retrieval/repositories.ts), MCP and CLI | [Discovery tests](../tests/integration/repositories.test.ts), [SDK/CLI smoke](../scripts/smoke-mcp.ts); build, typecheck, 30 tests, fixture validation and smoke passed | Local configuration allowlist; source freshness unchecked; maps deferred to AEF-002. [Usage](repository-discovery.md) |
| AEF-002 | 2026-10-01 | [Map service](../src/retrieval/repository-map.ts), [schema](../schemas/repository-map.schema.json), MCP and CLI | [Map tests](../tests/integration/repository-map.test.ts), [SDK/CLI smoke](../scripts/smoke-mcp.ts); build, typecheck, 35 tests, fixture validation and smoke passed | Generic Git and npm only; explicit rebuilds; no symbols or inferred responsibilities. [Usage](repository-maps.md) |
