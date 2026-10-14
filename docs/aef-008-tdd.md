# AEF-008 test-first evidence

Journeys derive from [AEF-008](FEATURE_TRACKER.md#aef-008-repeatable-onboarding-and-readiness-receipts) and the [PRD](PRD.md): an SDLC Command caller validates an existing Git repository before configuration, resumes durable local setup, distinguishes generated configuration from actual MCP verification and task consumption, and removes only unchanged setup-owned artifacts.

Branch `feature/aef-008-repeatable-onboarding` builds on AEF-007 PR #6 at `3b38193`; that PR remains a dependency until merged. AEF-006 hardening is on a separate unmerged branch. No real participating repository or native-client configuration was changed. All registered source checkouts used by tests are fictional temporary Git repositories.

## Executed RED/GREEN checkpoints

| Cycle | RED evidence | GREEN evidence | Checkpoints |
| --- | --- | --- | --- |
| Initial setup | Typecheck passed; all 8 new onboarding cases failed on unavailable apply/options | Typecheck/build passed; 8 onboarding cases and 10 facade cases passed | `624e40e` → `0ed4dbd` |
| Ownership and stale verification | Typecheck passed; 5 failed, 9 passed: uninstall overwrote unrelated settings, registration/launch changes were silently adopted, newer generation remained stale, malformed receipt lacked safe conflict | Same target all 14 passed; typecheck/build passed | `94a6004` → `c782f1f` |
| Interfaces and larger maps | Typecheck passed; 3 failed, 18 passed: readiness receipt absent, larger maps rejected by receipt-size cap, CLI setup unavailable | Same onboarding target and facade controls: all 31 passed; typecheck/build passed | `83b56eb` → `f921c17` |
| Pinned reload and input recovery | Typecheck passed; 2 failed, 23 passed: environment config replaced durable settings; unavailable inputs lacked retry guidance | Same 25 passed; scoped coverage passed | `f7570b6` → `0037e53` |
| Uninstall parent link | Typecheck passed; 1 failed, 25 passed: native junction redirected removal into synthetic source | Same 26 passed; typecheck/build passed | `440ebb3` → `65cac1d` |
| Scoped MCP output validation | Typecheck passed; 1 failed, 26 passed: incomplete data with a successful status label was accepted | Same 27 passed under coverage; typecheck/build passed | `f2f8700` → `805080c` |

During implementation, the map filename fingerprint was corrected to match the existing map service. Ownership fingerprints were changed to canonical object-key ordering after reloaded schema ordering caused false conflicts. The old facade test expecting `apply` capability unavailable was updated to validate non-Git roots before either plan/apply can mutate settings. These were part of the corresponding GREEN cycles, not independent claimed verification.

## Guarantees

| Guarantee | Test evidence |
| --- | --- |
| Separate/spaced roots, canonical registration, real stdio tool discovery and scoped response verification | Initial setup case and CLI subprocess case |
| Configuration generation never claims native connection/context consumption | Manual/native-adapter cases, literal false output schemas |
| Identical reruns reuse UUID/completed steps; HEAD/settings/generation changes invalidate prerequisites | Rerun, changed HEAD, owner/team and generation cases |
| Missing/corrupt knowledge and failed SDK checks preserve durable progress with safe retry diagnostics | Partial failure, unavailable inputs, malformed receipts and mocked SDK faults |
| Plans, wrong roots and conflicts do not create unapproved settings | Plan/root/identity cases |
| Dirty source and later readiness drift remain degraded without source mutation | Dirty and read-only drift cases |
| Current unrelated settings and pre-existing registration/maps survive uninstall | Ownership/config/environment cases |
| Existing links cannot redirect setup writes or uninstall removal into source | Actual Windows junction tests |
| Larger maps have their own bounded ownership-read allowance | 500-file synthetic source case |

Tests use real Git commits, SQLite indexes, atomic local receipt/config files, actual stdio MCP servers and CLI subprocesses. Selected SDK/input-failure faults are controlled; native directory junctions are real. There are no real project facts or application edits in the fixtures.

## Verification

Passed: `npm run build`, `npm run typecheck`, `npm test` (172 tests across 14 files), `npm run validate:fixtures`, `npm run smoke:mcp`, and `npm run coverage:aef-008` (all 27 onboarding cases). The real stdio smoke preserves nine-tool discovery, scoped reads, CLI map parity, conflict/policy and capture behavior. These totals include the stacked AEF-007 changes and exclude the separate unmerged AEF-006 hardening branch.

Scoped onboarding coverage: statements 89.10% (278/312), branches 83.49% (177/212), functions 92.15% (47/51), lines 98.64% (146/148). All four exceed the configured 80% thresholds. Artifacts remain ignored runtime files. Preserve the checkpoint table in any PR/squash description. Full protocol smoke and scoped onboarding coverage are independent checks.

## Limits

See [repeatable onboarding](repeatable-onboarding.md) for supported manual stdio setup, unsupported native adapters/edits, reserved future delivery verification, snapshot readiness, local locking/retained crash locks, receipt/map limits, and operator-owned runtime assumptions. This feature is not native-agent consumption, comprehensive power-loss/distributed recovery, shared authentication, or actual SDLC Command wiring. The independent AEF-005 relevant-record quality gate remains below target.
