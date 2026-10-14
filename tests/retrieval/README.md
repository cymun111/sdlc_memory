# Retrieval evaluation

Run `npm run evaluate:retrieval` for the versioned 36-task fictional strict-term baseline through real service and MCP SDK paths. Complete raw envelopes and measurements are written under ignored `.runtime/retrieval-evaluation/`. `npm run coverage:aef-005` checks the evaluator and scoring tests.

See [method, results and limitations](../../docs/retrieval-evaluation.md), [fixture v1](fixtures/v1.json), and [TDD evidence](../../docs/aef-005-tdd.md). The baseline currently measures 100% mandatory-policy visibility and 85.29% relevant-record coverage; the 90% quality target remains unmet. Hardware-dependent latency is reported without a CI timing threshold.
