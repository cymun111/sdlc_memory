# Multi-repository retrieval evaluation (AEF-005)

The versioned fictional evaluation measures deterministic weighted lexical matching, mandatory policies, and authorized curated graph traversal. The frozen AEF-005 strict-AND report remains unchanged for comparison. AEF-009 and AEF-010 use the same fixture annotations and relevance oracle; SDLC Command onboarding can reuse these local gates before accepting an adapter.

Run from the repository root with the installed Node/npm dependencies and Git:

```powershell
npm run evaluate:retrieval
npm run coverage:aef-005
```

The evaluator writes full raw responses and measurements to ignored `.runtime/retrieval-evaluation/v1.json`. Choose another output with `npm run evaluate:retrieval -- --output <file>`. `--fixture <file>` accepts the strict versioned fixture schema. Reports may contain synthetic temporary checkout paths; they contain no real registered repositories. Temporary Git repositories and indexes are removed even after failure. No application checkout is changed and no network access is required.

## Fixture and oracle

[Fixture v1](../tests/retrieval/fixtures/v1.json) contains 36 separately annotated tasks and 24 base records. Three registered fictional repositories represent an orchard API, a ledger worker, and an unrelated studio renderer. Vault and secret-team records are deliberately inaccessible. Five isolated knowledge snapshots cover normal retrieval, contradictory practices, stale policies, disputed policies, and missing indexes. Source files have real before/after Git commits; stale evidence is not simulated by a freshness flag. A conflict snapshot adds two curated contradictory records.

Expected relevant IDs are hand annotations. Mandatory IDs derive from the fixture's declared policies and applicability, independently of service results. Denied IDs, titles, summaries, team/repository sentinels, and source paths are checked across complete serialized service, MCP, and full-document envelopes. An annotation cannot declare an inaccessible record relevant or mark an unrelated ID as an accepted baseline miss.

Each task invokes `KnowledgeService.taskContext` and an actual SDK client/server pair through `InMemoryTransport`. The same task then loads every applicable, authorized, verified document through real `get` calls with a 32 KB body cap, following every generation-bound page until complete. Complete-envelope budgets can require multiple calls even when a body is below that cap. The manifest supplies authorized IDs: discovery/navigation overhead is not charged. Full-document loading has no task-word prefilter; it is a coverage/cost reference, not an agent simulation.

The curated orchard-to-checkout-to-ledger chain also tests task applicability: orchard must not receive ledger-only records even at graph depth two. A cross-repo record deliberately references vault evidence and a private relationship to test structural projection. Historical records, empty results, topics, changed paths, Unicode, denied lookup, explicit index failure, and mandatory-policy overflow have independent annotations.

## Measurements and gates

- Relevant-record coverage is micro recall over expected record/task pairs. A task with no expected records has a null individual ratio, not invented 100% recall.
- Mandatory-policy recall measures visible results **or explicit blocking issue/omitted-policy references**. Disputed policies and budget failures must remain visible as blockers; this metric does not assert normative compliance. Expected index/denied-identity errors have no policy recall denominator and must match the expected error separately.
- Stale-result observations list `needs_revalidation`, `dirty_worktree`, `unknown`, and `revision_not_checked` states. Unknown/unchecked evidence is not claimed fresh. Full-document `get` does not accept a requested source revision, so it cannot establish the same freshness verification as task context.
- Calls count application retrieval calls, excluding initialization and fixture construction. Full-document calls count each actual `get`.
- Bytes count serialized UTF-8 `{ok,data}` envelopes, summed over full-document reads. They exclude JSON-RPC framing and MCP's duplicate text representation. Estimated tokens use `ceil(bytes/3)` per task observation; full-document estimates apply to the aggregate bytes for that task. They are not model tokenizer measurements.
- Latency is one sequential sample per case and strategy. Fixture setup is excluded. Service runs before MCP before full-document loading; caches, Git subprocess startup, CPU, OS, and concurrent tests affect it. Timings are reported without CI thresholds or production speed claims.

The command exits nonzero for unexpected/missing relevant records, missing policy references, missing full-document oracle records, wrong statuses/freshness/conflict outcomes, budget violations, unauthorized exposure, or interface mismatches. Historical `baseline_missing` annotations remain in the unchanged fixture, but no longer exempt a miss: every expected relevant record is now required. The preserved strict-term report supplies per-case recovered/regressed comparisons. The 90% quality target is met on this corpus. No latency or percentage byte-reduction gate is imposed.

## AEF-009/010 measurements

The [new per-case report](evaluations/aef-009-010-v1-results.json) measures 34/34 relevant pairs (100%), 54/54 mandatory-policy references (100%, including explicit blockers), and 34/34 complete full-document relevant pairs. All five former missing pairs across tasks 25/26/27/29 are recovered, with no per-case regressions, unauthorized exposures or service/MCP differences. Three uncertain/stale observations remain labeled. Fixture annotations and the old report are unchanged; raw fixture hashes differ across LF/CRLF checkouts.

| Strategy, all 36 tasks | Calls | UTF-8 payload bytes | Estimated tokens |
| --- | ---: | ---: | ---: |
| Service task context | 36 | 76,349 | 25,465 |
| MCP task context | 36 | 76,349 | 25,465 |
| Complete full-document pages | 660 | 3,011,350 | 1,003,794 |

Summary context uses approximately 97.46% fewer logical payload bytes than complete document loading on this verbose synthetic corpus, while matching its annotated completeness. Its payload is larger than the old strict-term context because it now returns the recovered records. Full-document costs also increase with complete-envelope pagination and repeated metadata; compare completeness and accounting, not a claimed speedup. Generation/provenance values can change exact byte totals. See [ranking/continuation semantics](ranked-progressive-retrieval.md) and [TDD evidence](aef-009-010-tdd.md).

## Preserved AEF-005 baseline

The recorded run has 29/34 relevant pairs (**85.29%**, below the PRD's 90% target), 54/54 mandatory-policy references (**100%**), and 34/34 full-document relevant pairs. It detects zero unauthorized metadata exposures and zero service/MCP differences. Three returned uncertain/stale observations remain explicitly labeled. These results describe this fictional corpus only.

| Strategy, all 36 tasks | Calls | UTF-8 payload bytes | Estimated tokens |
| --- | ---: | ---: | ---: |
| Service task context | 36 | 72,723 | 24,252 |
| MCP task context | 36 | 72,723 | 24,252 |
| Full-document reads | 331 | 2,493,340 | 831,117 |

Recorded environment: Windows x64, Node v24.16.0, Git 2.54.0.windows.1, SQLite 3.53.0, MCP SDK 1.31.0, AMD Ryzen 5 7600X. Per-case timing samples and exact source/fixture hashes are in the published JSON. Output byte totals can vary with serialized provenance values; they are observations, not fixed cross-platform thresholds.

| Task | Strict-term miss relative to full documents | Follow-up |
| --- | --- | --- |
| 25: replay duplicate requests safely | `orchard.retry`, `cross.checkout` | AEF-009 natural task matching |
| 26: compare money totals | `ledger.reconcile` | AEF-009 natural task matching |
| 27: save a picture | `studio.export` | AEF-009 natural task matching |
| 29: cache expiry with changed source path | `orchard.cache` | AEF-009 path-aware matching |

The committed [per-case raw measurements](evaluations/aef-005-v1-results.json) retain exact metric values, environment, fixture hash, returned IDs, statuses, and blockers. Repeated full Markdown bodies and temporary snapshot metadata are omitted from that publication; the reproducible command retains complete envelopes in its ignored output. [TDD evidence](aef-005-tdd.md) records validation and checkpoints.

## Limits

This is a small curated synthetic corpus with intentionally verbose reference bodies; full-document costs depend on that choice. It is not representative production traffic, repeated statistical benchmarking, arbitrary-prose information-flow analysis, real owner approval, or proof of native-agent behavior. The SDK in-memory transport is exercised here; real stdio is covered separately by `npm run smoke:mcp`. Shared HTTP and authentication remain AEF-016 work. Passing these local quality gates does not establish SDLC Command integration or native-agent context consumption.
