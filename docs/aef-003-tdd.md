# AEF-003 test-first evidence

Date: 2026-10-13. Branch: `feature/aef-003-snapshot-provenance`. Baseline: main at `8cc6c75`, after AEF-002 PR #2 merged. No participating application repository was changed.

Source plan: [AEF-003](FEATURE_TRACKER.md#aef-003-snapshot-provenance-and-drift-reporting). Journeys: callers identify the actual indexed snapshot despite live checkout changes; maintainers reject inconsistent builds; workflow receipts distinguish indexed knowledge from application source; operators migrate legacy generations explicitly without inventing provenance.

## Executed RED/GREEN checkpoints

`npm test -- tests/integration/provenance.test.ts` invokes the existing complete test set because `npm test` already includes `tests`. All RED failures below were executed before their corresponding production changes. Checkpoints are preserved as separate branch commits.

| Stage | Commit | Evidence |
| --- | --- | --- |
| Initial RED | `bff9185` | Typecheck passed; all 9 new scenarios failed, existing 68 passed. Live HEAD relabeling, absent manifests, dirty/unversioned state, source-change acceptance and migration gaps reproduced |
| Initial GREEN | `e9aa779` | Same 9 scenarios and all 77 tests passed; typecheck passed |
| Isolation/receipt RED | `dd44244` | 14 scenarios executed; 2 failed for global count disclosure and missing map/session provenance; 12 controls passed |
| Isolation/receipt GREEN | `8c1aea9` | Same 14 scenarios and all 82 tests/typecheck passed |
| CLI/schema/revision RED | `a45e449` | Build passed; 17 scenarios executed, 3 failed for live CLI revision, stale schema caching and cross-repo revision misuse |
| CLI/schema/revision GREEN | `ff8ad86` | Same 17 scenarios and all 85 tests/build/typecheck passed |
| Refactor | `30950be` | All 85 tests/typecheck remained green; request metadata is reused and Git enumeration uses NUL-delimited paths |
| Captured-schema RED | `75651d3` | 20 scenarios executed, 1 failed: validation used later transient schema bytes outside the captured snapshot; HEAD-change, Unicode/CRLF and SDK controls passed |
| Captured-schema GREEN | `164c631` | Same 20 scenarios and all 88 tests/typecheck passed; records use the exact captured schema bytes |

## Guarantees

| Guarantee | Evidence | Result |
| --- | --- | --- |
| Clean manifest stores commit, generation, schema/indexer versions, time, counts and hashes | Complete-manifest test, including direct database count check | PASS |
| HEAD advancement never relabels an old index; live HEAD and content drift are distinct | Advancing-HEAD and historical identical-content tests | PASS |
| Dirty, unversioned and unavailable-Git snapshots have honest fingerprint labels | State-specific integration tests | PASS |
| Rebuild fingerprints are deterministic, including Unicode paths and normalized CRLF | Fingerprint and Unicode/line-ending tests | PASS |
| Record or HEAD changes during capture abort switching and preserve active identity | Controlled read fault and real Git HEAD-change tests | PASS |
| Captured schema is used; changing the schema recompiles its validator | Schema-cache and transient-schema read tests | PASS |
| Missing live knowledge gives drift uncertainty while indexed records remain readable | Unavailable-source test | PASS |
| Public metadata hides global counts; corrupt manifests fail | Private-record and metadata corruption tests | PASS |
| Primary source revisions cannot be applied to another repository | Two real synthetic Git checkout test | PASS |
| Discovery, maps, facade, prepared sessions and CLI reports retain indexed identity | Cross-interface and built-CLI subprocess tests | PASS |
| Legacy generations require rebuild instead of borrowing HEAD | Legacy metadata test | PASS |
| Actual stdio SDK client validates snapshot/drift and existing nine-tool behavior | `scripts/smoke-mcp.ts` | PASS |

Primary tests: [provenance.test.ts](../tests/integration/provenance.test.ts). Fixtures and commits are synthetic temporary repositories. Concurrent record/schema reads are deterministic faults; Git operations, SQLite manifests, parser/compiler behavior, CLI subprocesses and MCP SDK communication are real.

## Final checks and limitations

Final verification:

- `npm run build` and `npm run typecheck`: passed.
- `npm test`: all 88 tests across 10 files passed at the final GREEN stage; coverage reruns also passed the complete suite.
- `npm run validate:fixtures`: passed.
- `npm run smoke:mcp`: actual stdio SDK checks passed, including snapshot identity/drift, existing nine-tool behavior, and query/unavailable failures.
- `npm run coverage:aef-003`: statements 89.28%, branches 80.28%, functions 100%, lines 96.20%; all aggregate 80% gates passed for `src/indexing/provenance.ts`.
- `npm run coverage:aef-002`: expanded indexing/graph aggregate statements 91.73%, branches 83.92%, functions 91.66%, lines 97.77%; existing feature gates still pass.
- `git diff --check`: passed.

Reports remain under ignored `.runtime/coverage-aef-003/` and `.runtime/coverage-aef-002/`; these are targeted feature metrics, not repository-wide coverage claims. Preserve this RED/GREEN summary in the eventual PR or squash description if checkpoint commits are squashed.

Snapshot identity is evidence of captured bytes, not semantic correctness or continuous freshness. Rechecks do not lock live source repositories; changes after the final check are reported by subsequent drift reads. Drift scans are not performance-benchmarked. Source availability, automatic refresh, authenticated shared scopes, progressive budgets, and concurrency/power-loss guarantees remain tracked follow-ups. Public metadata omits counts; opaque whole-tree fingerprints/generation identities are still shared index metadata. No PR is created by implementation alone.
