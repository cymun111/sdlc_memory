# AEF-002 test-first evidence

Date: 2026-10-13. Branch: `feature/aef-002-safe-index-failures`. Base: AEF-001 commit `adf7722`; PR #1 was open when this branch was created. No participating application repository was modified.

## Source plan and journeys

The source plan is [AEF-002 in the feature tracker](FEATURE_TRACKER.md#aef-002-explicit-failures-and-safe-index-rebuilds). Journeys derived from its acceptance criteria:

- A workflow caller distinguishes empty authorized results from failed/unavailable retrieval without exposing private diagnostics.
- A maintainer rebuilds validated knowledge while preserving the last-good generation when source reads, validation, transactions, or switching fail.
- An agent using the real MCP SDK receives structured failure codes over both in-memory transport and stdio.
- An operator inspects bounded degraded build status and repairs/retries without discarding prior knowledge.

## RED/GREEN checkpoints

Each RED checkpoint was compiled/executed before its corresponding production fix. Checkpoints remain separate commits on the task branch. `npm test -- tests/integration/index-failures.test.ts` runs the repository's complete test set because its script already passes `tests`; counts below distinguish the new file from the full suite.

| Stage | Commit | Executed evidence | Guarantee after GREEN |
| --- | --- | --- | --- |
| Initial RED | `1bb439d` | Typecheck passed; 16 new scenarios executed, 14 failed and 2 positive controls passed | Missing indexes, swallowed FTS errors, invalid graph acceptance, failed-build cleanup/status reproduced |
| Initial GREEN | `6ed3ff6` | Same 16 scenarios passed; all 61 tests and typecheck passed | Read-only active indexes, sanitized failures, staging validation/switch preservation |
| Tree-validation RED | `54472fa` | 19 new scenarios executed, 1 failed; unresolved graph returned no validation issues | CLI validation gap reproduced; source-read and manifest fault controls passed |
| Tree-validation GREEN | `2810d38` | Same 19 scenarios and all 64 tests passed; build/typecheck/fixtures/extended stdio smoke passed | Required-source and graph failures prevent validation success |
| Corrupt-record RED | `7e8f354` | 22 new scenarios executed, 1 failed with raw YAML error | Indexed parser diagnostic leakage reproduced |
| Corrupt-record GREEN | `63875ef` | Same 22 scenarios and all 67 tests/typecheck passed | Safe query errors replace internal parser diagnostics; not-found remains distinct |
| Staging-initialization RED | `851e0e3` | 23 new scenarios executed, 1 failed with raw filesystem error | Unguarded staging-directory initialization reproduced |
| Staging-initialization GREEN | `c4558e4` | Same 23 scenarios and all 68 tests/typecheck passed | Staging setup participates in guarded failure handling; diagnostic status is schema-validated |

The corrupt-database RED run also exposed a Windows cleanup lock from a leaked failed-open connection. Reader initialization now closes failed database handles; the GREEN runs clean up successfully.

## Test specification

| Guarantee | Test evidence | Type | Result |
| --- | --- | --- | --- |
| All published read methods require an active index and never create a fallback | `index-failures.test.ts`: existing-index test | Integration | PASS |
| Existing empty root is valid; missing/unreadable required directories and records fail | Empty-root, nested-directory, record-read, staging-initialization tests | Fault-injected integration | PASS |
| Invalid Markdown, duplicate IDs, unresolved targets, invalid edge types, and both forms of supersession cycles cannot replace active knowledge | Parameterized rejected-build cases | Integration | PASS |
| Related-to cycles and retained historical targets remain valid | Positive graph control | Integration | PASS |
| Switch/transaction failures preserve readable prior records and clean only attempted artifacts | Switch-failure and transaction-failure tests | Fault-injected integration | PASS |
| Retry after switch failure returns ready status | Switch/recovery test | Integration | PASS |
| Missing/corrupt databases, malformed/escaping manifests, and generation mismatches are unavailable | Manifest/corrupt-database cases | Integration | PASS |
| Broken FTS and corrupt stored metadata cannot masquerade as empty success | Query/corrupt-record tests | Integration | PASS |
| Genuine no-match context stays successful | No-match positive control | Integration | PASS |
| Application facade preserves query code and retry guidance | Facade test | Integration | PASS |
| Actual SDK client receives distinct sanitized error envelopes | SDK linked transport test and `scripts/smoke-mcp.ts` | MCP integration/stdio smoke | PASS |
| Existing CLI parity, scope denial, candidate replay/update, and nine-tool discovery are retained | Full suite and extended smoke | Regression | PASS |

Primary test file: [index-failures.test.ts](../tests/integration/index-failures.test.ts). Test sources are fictional isolated temporary roots; permission/switch faults are deterministic mocks, while databases, SQL corruption, transactions, records, and MCP SDK calls are real.

## Final validation and coverage

- `npm run build`: passed.
- `npm run typecheck`: passed.
- `npm test`: 68 tests passed across 9 files at the final GREEN stage.
- `npm run validate:fixtures`: passed.
- `npm run smoke:mcp`: passed, including explicit stdio query and unavailable-index failures.
- `npm run coverage:aef-002`: all 68 tests passed; aggregate statements 93.52%, branches 86.36%, functions 83.33%, lines 99.06%. Each aggregate 80% gate passed.
- `git diff --check`: passed.

Coverage scope is `src/indexing/**` and `src/validation/graph.ts`; it is not repository-wide coverage. The pinned matching Vitest coverage provider is a development dependency. Reports are ignored runtime artifacts. Individual modules can have metrics below 80%; the command enforces aggregate feature thresholds.

## Limits and merge evidence

Build status is best-effort when runtime storage cannot be written, and is not authenticated health. Tests simulate controlled transaction and pre-switch interruption failures; they do not prove power-loss durability or all abrupt hard-kill scenarios. Hard kills can leave unreferenced attempt files; no arbitrary sweeping of historical runtime files is implemented. Concurrent-writer serialization/recovery, retention, remote operation, immutable snapshot provenance, and conflict/policy isolation remain tracked follow-ups.

Keep this RED/GREEN summary in the eventual PR/squash merge description if checkpoint commits are squashed. AEF-002's eventual PR should target the AEF-001 branch while PR #1 is open, or main after that dependency is merged and the branch baseline is reconciled. No PR was created by implementation alone.
