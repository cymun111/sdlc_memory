# AEF-004 test-first evidence

Date: 2026-10-13. Branch: `feature/aef-004-conflicts-policies-isolation`. Baseline: main at `d14d85d`, after AEF-003 PR #3 merged. No participating application repository was modified.

Source plan: [AEF-004](FEATURE_TRACKER.md#aef-004-conflict-visibility-policies-and-response-isolation). Journeys: a caller receives only authorized metadata; required policy uncertainty blocks planning; operators inspect historical context explicitly; owners review persistent reports without silently rewriting knowledge; bounded conflict traversal and failure diagnostics remain honest.

## Executed checkpoints

The test script includes the full `tests` directory, so `npm test -- tests/integration/policy-isolation.test.ts` runs both the new cases and existing regression tests. Every production fix below followed executed RED tests.

| Stage | RED evidence | GREEN evidence |
| --- | --- | --- |
| Initial metadata/policy/conflict gaps | `f372b56`: typecheck passed; 14 new cases executed, 12 failed and 2 controls passed; existing 88 passed | `1613939`: same 14 cases and all 102 tests/typecheck passed |
| Owner review, alias identity, review-date/test evidence | `bdd6403`: 19 cases executed, 3 intended failures | `8f6c9ac`: same 19 cases and all 107 tests/typecheck passed |
| CLI review, private-body parsing, receipt paths, authorization changes | `7e4358d` added tests; a mock typing error was corrected before production edits. `58f5809`: typecheck passed; 23 cases executed with the same 4 intended failures | `2d0f103`: same 23 cases and all 111 tests/build/typecheck passed |
| Partial evidence, future approvals, invalid body budget | `5651542`: typecheck passed; 26 cases executed with 3 intended failures | `9fae0ee`: same 26 cases and all 114 tests/typecheck passed |
| Returned-neighbor relevance, conflict visit bounds, explicit owner scope | `755c7af`: typecheck passed; 35 cases executed with 3 intended failures; additional team/projection/lock/forgery controls passed | `8cdd759`: same 35 cases and all 123 tests/build/typecheck passed |
| Optional directory permission suppression | `a7ee1f5`: typecheck passed; 36 cases executed with 1 intended failure; extended stdio controls added | `724e0e9`: same 36 cases and all 124 tests/typecheck passed |
| Report writes through linked ancestors | `4836eab`: typecheck passed; 37 cases executed with 1 intended failure; source directories were created before rejection | `67553c3`: same 37 cases and all 125 tests/typecheck passed; ancestor validation precedes creation |

## Guarantees and tests

Primary file: [policy-isolation.test.ts](../tests/integration/policy-isolation.test.ts).

| Guarantee | Evidence | Type |
| --- | --- | --- |
| Denied identities, source paths, reference targets, unknown evidence fields and cross-repo scope members are excluded | Summary/body/source/scope and denied-corrupt-body cases | Integration |
| Historical inspection is explicit and cannot expose candidates/denied records | History, UTF-8 and SDK/CLI cases | Integration and actual SDK/CLI |
| Stale, dirty, unchecked, unknown, disputed, overdue, conflicted and unapproved policies cannot establish compliance | Policy cases using synthetic commits and explicit source revisions | Git/SQLite integration |
| Partial hidden evidence, unverified test artifacts and future approvals remain blockers | Evidence bypass cases | Integration |
| Candidate reports and curated contradictions surface without changing published status | Persisted/curated conflict cases | Integration |
| Mixed-access report IDs/counts/explanations stay out of ordinary retrieval | Mixed-access and private explanation cases | Integration |
| Related graph nodes and conflict chains retain relevant bounded references | Chain, neighbor and visit-cap cases | Integration |
| Impossible budgets and mandatory result overflow return blocking outcomes | Byte/token/result limit cases | Integration |
| Owner-only resolution preserves reason/history and rejects stale hashes, locks and access changes | Owner, forged-resolution, lock and transition cases | Integration |
| Malformed or unreadable state cannot become a successful empty conflict list | JSON and permission cases | Deterministic fault integration |
| Existing linked candidate ancestors cannot cause report directories to be created in a source checkout | Native junction/symlink write-boundary case | Filesystem integration |
| Real stdio SDK flow covers report creation, owner CLI resolution, historical inspection and policy blocking while retaining nine-tool behavior | [Smoke script](../scripts/smoke-mcp.ts) | SDK stdio and CLI |

All 37 new cases use fictional isolated roots. Git commits, databases, canonical report files, native junctions/symlinks, SDK calls and CLI subprocesses are real; permission and authorization-transition faults are controlled. Passing tests establish structural isolation/local lifecycle behavior, not classification of arbitrary prose or shared authentication.

## Final verification

Final verification passed: `npm run build`, `npm run typecheck`, `npm run coverage:aef-004` (all 125 tests across 11 files), `npm run validate:fixtures`, `npm run smoke:mcp`, and `git diff --check`. The coverage command runs the full test suite with scoped coverage thresholds.

Scoped coverage: statements 90.32% (439/486), branches 87.67% (320/365), functions 90.90% (100/110), and lines 97.51% (314/322). All four exceed the configured 80% threshold. Reports remain ignored runtime artifacts. Preserve this RED/GREEN summary in the eventual PR/squash description if commits are squashed.

## Limits

Local owner roles come from trusted configuration; remote approval authenticity, shared ACLs and protected-branch publication are not established. Report resolution is a worktree operation. Crash locks and comprehensive multi-process/power-loss recovery remain follow-ups. Known structured metadata is projected; arbitrary prose must be classified by authors/reviewers. Conflicts are explicit reports/edges, not inferred contradictions. Live conflict state is separate from indexed provenance. Full response budgets outside task context remain AEF-010 work. No actual SDLC Command wiring or native agent verification is claimed.
