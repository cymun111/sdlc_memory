# AEF-014 receiving release checkpoint

Date: 2026-11-24. The receiving implementation and disposable real API/database/
Runner/Codex pilot passed. Application PR: https://github.com/cymun111/sdlc_command/pull/35.
Production release and participating Runner activation remain pending; this does
not claim a fully activated production integration.

The release branch is based on merged SDLC Command main and excludes its separate
login-refresh PR. Memory implementation remains standalone and unchanged from
AEF-013. No canonical store was moved and no shared HTTP endpoint was introduced.

Current evidence:
https://github.com/cymun111/sdlc_command/blob/feature/aef014-release/docs/development/AEF-014-RELEASE-EVIDENCE.md

Receiving changes expose the bounded Git/npm repository-map summary in Settings,
require an exact source/configuration-bound review hash before native task
preparation, and reject stale review. Configured/service-verified, reviewed,
consumed and durable completion remain distinct.

The real receiving pilot used actual Express/session authentication, PostgreSQL,
Runner enrollment/queue/events/completion, a managed Git worktree, Agent Core,
Codex SDK 0.152.1 and Memory workers. OAuth identities and external setup were
seeded fictional fixtures; local Git/provider prerequisites were checked in the
harness. It is not an interactive browser or production onboarding claim.

Both learning and no-learning outcomes consumed nonempty fictional published
context and persisted after worker restart. Learning exercised authorized
candidate list, complete inspection, full-file hash, update, stale rejection and
reinspection through actual API assignments. Candidates stayed unpublished.

Receiving direct tests cover drift, policy failure, cancellation, malformed
outputs, unavailable clients, interrupted locks, failed intake with three bounded
attempts, replay conflicts and database authorization. Real-service tests
preserve externally edited settings. Disposable stopped-writer backup/restore
preserved native receipt identity/digest/replay and candidate content/hash.
Packaged compiled code plus standalone Memory dependencies/schemas passed from
an unrelated working directory. Production backup rehearsal and physical
relocation were not performed.

Clean-release Runner/API/web coverage exceeds each existing 90% aggregate gate;
no thresholds/exclusions were relaxed. Memory's unchanged 36-task oracle again
passed 34/34 relevant pairs, 54/54 mandatory policy references, zero unauthorized
exposures/interface mismatches and no regressions; three stale observations remain
labeled. These measurements use a synthetic corpus.

Administrator AWS SSO must be refreshed for the separate Runner rollout. API/web
uses GitHub OIDC, exact-main Quality and the existing Production workflow. Update
this checkpoint with merged/deployed revisions and actual host rollout evidence
before marking production activation complete.
