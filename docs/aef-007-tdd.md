# AEF-007 repository-map hardening

AEF-007's Git/npm extraction and read interface already existed. Acceptance review found unsafe cached paths reaching responses and pre-existing directory links redirecting map writes. This follow-up preserves existing extraction, tool names, CLI commands, output fields, pagination, and freshness for SDLC Command onboarding.

Branch: `feature/aef-007-map-hardening`, based on main at `9cba7b0` (merged AEF-005). The separate AEF-006 hardening branch is not included. No real participating repository was modified; fixtures use isolated temporary Git repositories.

Journeys derive from [AEF-007](FEATURE_TRACKER.md#aef-007-evidence-backed-repository-maps): agents receive safe relative navigation references; cached data cannot bypass file exclusions; existing links cannot redirect map writes into application source; cache reads reject linked files while preserving navigation behavior.

| Cycle | Executed RED | Executed GREEN | Checkpoints |
| --- | --- | --- | --- |
| Cached paths and directory writes | Typecheck passed; map target: 7 failed, 5 existing controls passed | Same target: all 12 passed; typecheck passed | `d098c95` → `f3c4655` |
| Linked cache-file reads | Typecheck passed; map target: 1 failed, 12 passed because link metadata was ignored | Same target: all 13 passed; typecheck passed | `a69ef72` → `00869a2` |

The native Windows file-symlink setup initially failed with `EPERM`; that was not counted as RED. Before production changes, the test was revised to inject only `lstat` link metadata on a real valid cache file and re-executed to obtain the intended failure. The directory-link test uses a real Windows junction (directory symlink elsewhere), checking directory contents and clean source Git status.

| Guarantee | Evidence |
| --- | --- |
| Traversal, absolute, drive-prefixed, sensitive and excluded cached paths are rejected before serialization | Six cache-tampering integration cases |
| Linked map directories cannot redirect writes into synthetic application source | Native junction/symlink case |
| Linked cache-file metadata is rejected before reads | Controlled filesystem-metadata case |
| Commands, packages, hashes, scopes, freshness, pagination and byte budgets remain | Five existing map integration controls |
| Real CLI/MCP map navigation and parity remain | `npm run smoke:mcp` |

## Verification

Passed: `npm run build`, `npm run typecheck`, `npm test` (145 tests across 13 files), `npm run validate:fixtures`, and `npm run smoke:mcp`. Eight new integration cases are included; totals exclude unmerged AEF-006 hardening.

```powershell
npx vitest run tests/integration/repository-map.test.ts --coverage --coverage.include=src/retrieval/repository-map.ts --coverage.reportsDirectory=.runtime/coverage-aef-007 --coverage.thresholds.statements=80 --coverage.thresholds.branches=80 --coverage.thresholds.functions=80 --coverage.thresholds.lines=80
```

All 13 map cases passed under coverage: statements 90.53% (153/169), branches 83.82% (114/136), functions 100% (28/28), lines 99.10% (111/112), all above 80%. Structural JSON-schema path examples passed. Artifacts remain ignored runtime files. Preserve these checkpoints in any eventual PR/squash description.

## Limits

Runtime Zod validation applies normalization/exclusions beyond JSON-schema structural constraints. Maps remain untrusted navigation data; these checks do not prove cache authenticity, classify arbitrary labels/warnings, or verify application behavior. Existing links are rejected, but concurrent filesystem replacement and hard-link protection are not established. Runtime roots remain trusted operator configuration. No automatic refresh, symbol extraction, native-agent behavior or SDLC Command wiring is added.
