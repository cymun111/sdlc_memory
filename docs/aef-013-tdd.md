# AEF-013 test-first evidence

Date: 2026-10-15 (America/Phoenix). Branch: `feature/aef-013-candidate-inspection`, based on merged AEF-011/012/main `5ee0aa6`. Scope was narrowed explicitly to AEF-013 before implementation. No SDLC Command or other application repository was read or edited for implementation. The PRD was read first; journeys derive from the feature tracker's bounded candidate inspection criteria.

## Checkpoints and guarantees

| Stage | Executed evidence | Checkpoint |
| --- | --- | --- |
| RED | `npm run typecheck` passed; all seven executed SDK integration tests failed because candidate read tools were absent | `45eaa5f` |
| GREEN | Same seven tests passed after adding the read-only service, schemas and MCP bindings; typecheck passed | `7cbb7f0` |
| Additional regression coverage | Thirteen SDK tests passed; scoped inspection coverage exceeded all four 80% gates | Final completion commit |

The initial scoped run had 73.61% branch coverage, below the gate. Additional meaningful cases cover direct validation, invalid output rejection, shared/team/cross-repo applicability, private edits not invalidating visible pages, stale/forged UTF-8 continuations, envelope trimming, exact final-page accounting, and sanitized malformed state. The stdio harness initially reused an existing variable name; that compile error was fixed before the passing smoke check and is not claimed as feature RED evidence.

| Guarantee | Evidence |
| --- | --- |
| Operation-specific schemas and read-only annotations | Tool discovery and malformed operation-output SDK tests |
| Submit → list → inspect → update → stale rejection → reinspect | In-memory SDK integration and independent real stdio smoke |
| Reads create no SQLite ledger and leave a committed writer journal unchanged | Empty inspection and pending-update journal case |
| Owned/applicable pending records only, aliases canonicalized, no hidden totals/generated paths | Ownership/scope and denied malformed-directory cases |
| Concurrent edits invalidate continuations; private edits do not affect visible pages | Listing/body continuation and hidden-state isolation cases |
| Exact full-file hashes, valid UTF-8 reconstruction and complete-envelope accounting | Multibyte paging, token/byte minimums, list trimming and exact final-page case |
| No publication or approval rights granted | Candidate stays absent from `get_knowledge` and published search after the editing cycle |

Implementation: [inspection service/schemas](../src/capture/inspection.ts), [MCP bindings](../src/mcp/server.ts). Tests: [candidate inspection](../tests/integration/candidate-inspection.test.ts), [stdio smoke](../scripts/smoke-mcp.ts). The service does not reuse the old writer-backed `listCandidates` helper because that helper can perform recovery. It reads only owned candidate paths and validates outputs before returning public data.

## Verification

Passed: `npm run typecheck`, `npm run build`, `npm run validate:fixtures`, real eleven-tool `npm run smoke:mcp`, and `npm test` with scoped coverage (269/269 tests across 19 files, including all 13 inspection cases). Inspection coverage: statements 95.65% (110/115), branches 88.88% (64/72), functions 95.65% (22/23), lines 100% (78/78). All four 80% gates pass; the unchanged retrieval evaluator remains green. Reproduce the new-service coverage gate with:

```powershell
npm test -- --coverage --coverage.include=src/capture/inspection.ts --coverage.reportsDirectory=.runtime/coverage-aef-013 --coverage.thresholds.statements=80 --coverage.thresholds.branches=80 --coverage.thresholds.functions=80 --coverage.thresholds.lines=80
```

Coverage artifacts remain ignored. This gate covers the new inspection service, not the entire repository. Historical nine-tool smoke reports remain unchanged; the current server/smoke advertise eleven. [Behavior and limits](candidate-inspection.md) document owner-only local access, raw untrusted Markdown, pending-file versus ledger state, scan limits, error-budget exceptions and filesystem race limits. No HTTP/authentication/native-client or receiving-system integration is claimed. AEF-014 remains planned.
