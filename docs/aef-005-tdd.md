# AEF-005 test-first evidence

Journeys derive from [AEF-005](FEATURE_TRACKER.md#aef-005-multi-repository-retrieval-evaluation) and the [PRD](PRD.md): an SDLC Command maintainer can reproduce multi-repository retrieval measurements before integration; an engineer can see strict-term misses against full documents; a reviewer can distinguish policy blockers, denied scopes, and explicit errors from empty success; CI catches baseline regressions without hardware timing gates.

The branch is `feature/aef-005-retrieval-evaluation`, based on merged AEF-004 (`66ffafc`). No participating repository was changed. All Git sources/indexes used by the evaluator are fictional temporary checkouts.

| Cycle | Executed RED | Executed GREEN | Reachable checkpoints |
| --- | --- | --- | --- |
| Runnable baseline | Typecheck passed; `npx vitest run tests/retrieval/evaluation.test.ts`: 1 failed because the required evaluator entry point was not implemented | Same test: 1 passed; typecheck passed; 36 service/MCP/full-document tasks executed | `86983cb` → `bef0389` |
| Per-case regression gate | Typecheck passed; scoring target: 1 failed, 3 passed; missing baseline-gate function | Retrieval target: all 5 passed; unexpected losses/extras and explicitly annotated misses distinguished | `988b9c9` → `e51bce7` |
| Oracle validation | Scoring target: 2 failed, 4 passed; out-of-oracle misses and inaccessible relevance were accepted | Typecheck and same scoring target: all 6 passed | `602c19b` → `4c82262` |
| Safe fixture filenames | Scoring target: 4 failed, 6 passed; traversal, slash, drive and malformed dotted IDs accepted on an unreferenced record | Typecheck and same scoring target: all 10 passed | `44fc2e8` → `d06476c` |

During the first cycle the evaluator's synthetic owner initially used the reserved `fixture-owner`, which production retrieval correctly excludes for registered repositories. The dataset now uses `synthetic-owner` inside isolated temporary roots; no production fixture filter was changed. The unsafe-ID tests were corrected to use an unreferenced record before the RED checkpoint, avoiding failures caused by unrelated missing oracle references. Both corrections preceded their corresponding production fixes.

| Guarantee | Evidence | Type |
| --- | --- | --- |
| Reproducible command emits version, environment, hashes, raw cases and strategy measurements | `tests/retrieval/evaluation.test.ts` CLI journey | Subprocess integration |
| 36 fictional tasks exercise real service, SQLite, Git evidence and SDK MCP paths with parity | Same file's direct journey | SDK/service integration |
| 54/54 mandatory references remain visible, including disputed and overflow blockers | Annotated cases 20, 32–34; pinned aggregate | Integration |
| Known synonym/path gaps remain visible as 29/34 coverage and four per-case comparisons | Cases 25–27 and 29; pinned aggregate | Retrieval evaluation |
| Empty denominators, misses and duplicate annotations are scored explicitly | `tests/retrieval/scoring.test.ts` | Unit |
| Denied metadata scanning covers bodies and errors; invalid or duplicate oracle entries are rejected | Scoring tests and all serialized strategy outputs | Unit/integration |
| Custom fixture IDs cannot become unsafe filenames | Four unsafe-ID tests | Schema boundary |

## Final verification

Final verification passed: `npm run typecheck`, `npm run build`, `npm test` (137 tests across 13 files), `npm run validate:fixtures`, `npm run smoke:mcp`, and `npm run coverage:aef-005` (all 12 retrieval/scoring cases). The real stdio smoke retains nine-tool discovery and existing conflict/policy/capture boundaries. The reporting/provenance refactor and direct SDK baseline controls are preserved in checkpoint `26e24e8` after the 137-test GREEN run.

Scoped evaluator coverage: statements 94.04% (221/235), branches 83.46% (106/127), functions 97.01% (65/67), lines 99.27% (137/138). All four pass the configured 80% thresholds. There are no skipped tests. These coverage percentages describe the evaluator module, not the entire application. Process-launch/CLI wrapper behavior is covered by the subprocess journey; injected filesystem/transport failures are not exhaustive. Preserve this RED/GREEN table in the eventual PR/squash description if checkpoint commits are squashed.

The final `npm run evaluate:retrieval` run passed all safety/regression gates and published 36 per-case measurements: 29/34 relevant pairs, 54/54 mandatory references, 34/34 full-document relevant pairs, zero scope exposures and zero interface mismatches. Complete runtime responses remain ignored; [published raw measurements](evaluations/aef-005-v1-results.json) retain the observed numeric values and response IDs/status/blockers. Local Markdown links and `git diff --check` passed.

## Scope

This feature establishes reproducible evaluation rather than changing ranking. The 90% relevant-record target remains unmet and must be addressed/re-evaluated by AEF-009/010 before claiming the corresponding SDLC Command readiness gate. [Method and limitations](retrieval-evaluation.md) explain policy visibility versus compliance, synthetic reference-body lengths, payload accounting, sequential latency, the manifest-assisted full-document baseline, and in-memory transport. Native agent, shared HTTP, and remote publication behavior are not established here.
