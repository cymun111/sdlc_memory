# AEF-014 historical receiving-system checkpoint

Superseded by the [November release checkpoint](aef-014-release-evidence.md).

Date: 2026-10-15. Status: In progress; full API/database pilot pending.

AEF-013 merged in PR 10 at b0b7002. The receiving SDLC Command baseline is
67b6c57115c88efeebb50d7f0717a9f372dcda6c. Implementation is on its
feature/aef-014-memory-integration branch. This Memory branch changes evidence
only; no Memory implementation, canonical knowledge, candidates or store layout
has been changed. No AEF-014 PR has been published yet.

The receiving change adds a Runner-host structured process bridge over existing
Memory services, trusted project UUID bindings, final Settings setup controls,
onboarding receipt correlation, candidate refinement, and an opt-in Agent Core
same-session acknowledgement/task/completion path. Native delivery and durable
no-learning receipts belong to that adapter, separate from codex-exec-v1. No
standalone-session acknowledgement is presented as proof of a separate agent's
consumption. Shared HTTP authentication and protected publication stay out of scope.

Receiving evidence and operator instructions:

- [Implementation evidence](https://github.com/cymun111/sdlc_command/blob/feature/aef-014-memory-integration/docs/development/AEF-014-EVIDENCE.md)
- [Operator walkthrough](https://github.com/cymun111/sdlc_command/blob/feature/aef-014-memory-integration/docs/operations/KNOWLEDGE_INTEGRATION.md)
- [Design](https://github.com/cymun111/sdlc_command/blob/feature/aef-014-memory-integration/docs/architecture/AEF-014.md)

These branch links identify local review work and will resolve remotely only
after the receiving branch is published.

Local checks include executed RED/GREEN checkpoints, receiving build/typechecks,
API/Runner/UI tests, eight real-service worker cases, and an isolated copied
package invoked from an unrelated working directory. A concurrently loaded test
run hit frontend/infrastructure timeouts; serialized reruns passed 148 web and
28 infrastructure tests. Copied artifacts contained code/schemas/dependencies,
never the canonical store.

Memory's unchanged retrieval evaluator passed all 36 tasks: 34/34 relevant pairs,
54/54 mandatory-policy references including explicit blockers, zero detected
unauthorized exposures/interface mismatches, no regressions. Three uncertain or
stale observations remain labeled. These synthetic results do not establish
production relevance or real-client readiness.

Node was v24.16.0; available Codex was 0.162.0-alpha.17.2. The global home was
logged out, but the receiving local managed Runner provider home was authenticated
using ChatGPT. The local API health and Docker engine were unavailable. No full API/PostgreSQL/
Runner/client pilot, publication or deployment occurred. Receiving discovery/
review wiring, broader interruption/drift/settings fault cases, measured feature
coverage, database-backed authorization and backup/restore parity remain open.

Retain Memory as a standalone package and one canonical store. The receiving
walkthrough documents explicit roots, distribution inputs, stopped-writer
backups and rollback. No physical relocation or restore-parity claim is made.
AEF-014 must not be marked Done from these checks.

## Actual Runner/client verification

The real LocalRunner polling/HTTP RunnerApiClient, Agent Core/Codex SDK and local
Memory worker passed both learning and no-learning completion with a fictional
loopback HTTP control plane. This is a real-client check, not the full receiving
API/PostgreSQL pilot. The selected SDK client was codex-cli 0.152.1, distinct from
the installed global 0.162 CLI. Both final runs acknowledged the nonempty
fictional.greeting record before planning and remained durable after worker
restart. The learning run also listed, fully inspected, updated and reinspected
fictional.client; a stale hash was rejected and the candidate stayed unpublished.

The first real-client check exposed an SDK turn-drain race. A deterministic RED
regression failed; receiving fix ef58fd7 serializes stream drainage and all 15
Agent Core tests/build passed. A subsequent nonempty-context RED check exposed
lexical query dilution; the adapter now binds a concise objective separately
from the full task prompt. Corrected real-client reruns passed both outcomes.

Sanitized correlation:

- No-learning task 20bd3741-2df8-4394-a673-0ed3e2796253, native session
  b86ab0eb-acb8-40a1-97ad-bd2e630bf58e, generation
  056f62e8-f7af-4ccd-85a1-d8cb4a22250e.
- Learning task 710048bd-4b12-4f9c-b9be-732b03fd3b7f, native session
  fb721ce8-fe06-4c02-99de-b5937f2db34a, generation
  32431f57-3ff9-4615-b761-d9d03393d2fe.
- Candidate old hash 4adc3ca2397abfab355502a74031f99bf4b1f49415652f9aa6f0521dc07982be;
  new hash 4ecf8d9856391963f2bc28244fcd6346932a0a74b0a09b1fb0d9ea59b45795be.

The eight expanded real-service tests passed in 85.06 seconds after using a
bounded 90-second per-case allowance for multiple Node/Git subprocesses on
Windows; the earlier 30-second allowance produced two timeouts under load.
No assertions were removed. Full API/database authorization, discovery/review,
broader failure/coverage and restore-parity acceptance gates remain open.
Receiving implementation checkpoint: f97c2cc on feature/aef-014-memory-integration.
Final targeted checks: 25 API and 36 Runner tests, API/Runner typechecks, changed-file ESLint and whitespace checks passed.
