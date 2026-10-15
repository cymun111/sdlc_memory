# Safe capture and verified sessions

AEF-011 hardens the shared local capture service. AEF-012 adds the `codex-exec-v1` read-only session adapter. SDLC Command can call these services or CLI handlers after onboarding; receiving-system wiring remains AEF-014. Native MCP templates, global hooks, other clients and authenticated HTTP remain separate capabilities.

## Intake and retained history

Initial submissions and updates must pass the record schema, ownership/scope checks, a 65,536-byte UTF-8 limit, and recognizable-secret screening before payload writes. The shared service enforces this for CLI, MCP and session intake; a future HTTP adapter must reuse it. Session tasks are capped at 16,384 bytes; entire completion JSON files are capped at 65,536 bytes, so their Markdown allowance is smaller than direct intake. Invalid UTF-8, NULs and nonregular linked inputs are rejected.

Screening rejects PEM private-key headers, familiar GitHub token prefixes, AWS access-key IDs, long OpenAI-style key prefixes, and long password/API-key/access-token assignments. Diagnostics never echo the matched value. Fictional examples with these shapes can be false positives; redact them. Encoded, fragmented, unfamiliar and contextual secrets can escape this deterministic check: it is not comprehensive DLP. Never store credentials in knowledge, runtime artifacts or prompts.

Canonical ancestor checks reject symlinks/junctions on candidate, history, publication and runtime paths. Bounded reads compare file identity and metadata around the read. Creation uses flushed exclusive temporary files and a no-overwrite hard-link installation; the storage filesystem must support hard links. Updates retain the inspected original in `candidates/<repo>/history/<id>/versions/<sha256>.md` before replacement and recheck the expected file after staging. Published/rejected candidates retain original Markdown and a schema-versioned `decision.json` under `candidates/<repo>/history/<id>/<sha256>/`. Rejection is owner-only. These are versionable records; no automatic Git commit or protected publication occurs.

SQLite serializes cooperative writers. Initialization sets its busy timeout before journal setup, closes failed connections, and retries transient locks at most four times with short backoff. Exhaustion returns a safe `CONFLICT`; retry the same payload/key after active writers finish. Same-key changed content conflicts. A conflicting record ID is rejected before queuing, so an ordinary input conflict cannot block later journal recovery. Identical rejected content under another key returns the retained rejected receipt, rather than creating another pending candidate.

## Recovery

Creation, update and review operations have committed journals bridging SQLite and the filesystem. Opening the ledger through intake/list/inspect reconciles pending operations. Recovery accepts only the expected old content or exact intended replacement/history; unrelated edits produce `CONFLICT` and remain untouched. Creation retains the validated payload before installing its file. Review retains the publication payload, original candidate, reason and decision timestamp before filesystem changes. Receipt state changes only after required files are in place. Legacy update journals cannot reconstruct a pre-upgrade original already replaced before history retention existed.

After recovering an interrupted publication, rebuild with `knowledge index --full` to refresh derived retrieval. A `published` receipt describes the knowledge worktree, not an indexed generation, Git commit or merged PR. Keep runtime SQLite/WAL files and pending journals in backups, out of Git. Retain candidate/history files in the knowledge checkout. A schema-invalid or conflicting journal needs operator inspection; do not delete it and retry blindly.

The tests inject creation/update/review interruptions and an edit after replacement staging, and launch six real competing submission processes. These establish controlled local recovery. Ancestor checks cannot make portable Node filesystem calls race-free against a hostile process able to rename trusted directories between system calls. Restrict OS write access to roots. Hard-kill/power-loss durability, hostile-directory replacement, distributed writers and network filesystems are not established by these checks.

## Codex session workflow

Build first, then use explicit roots/configuration as for other commands:

```powershell
knowledge session install
knowledge session status
knowledge session start --repo <id> --agent codex --task-file <file>
knowledge session start --repo <id> --agent codex --task-file <file> --prepare-only
knowledge session resume --session <uuid>
knowledge session finish --session <uuid> --learning-file <file>
knowledge session uninstall
```

Installation owns only `.runtime/session-adapters/codex-exec-v1/` configuration and its ownership fingerprint. It checks the executable/version, is optional for direct launches, and never edits native/global client settings or participating repositories. External modifications or ownership changes block removal/launch; unrelated settings remain. Custom `--launcher` overrides are for explicit adapter testing and always keep `real_client_verified:false`. Only Codex is supported by this session adapter. Start/resume/finish are the selected task-start/completion handlers; native product hook installation is not enabled.

Each session obtains schema-validated task context at the source revision. Required policy review, missing context or mandatory-budget failure blocks task release. Empty optional results are normal; optional truncation remains explicit in `truncated` and omitted counts, which downstream callers must treat as degraded optional coverage. There is no fail-open path for required context. Preflight errors before a session can be allocated return errors rather than fabricated provenance.

The adapter launches two separate `codex exec` processes with stdin JSON, JSON Schema-constrained final output, JSONL turn events, `--ephemeral`, `--ignore-user-config`, and a read-only sandbox. The first receives context without the task and must acknowledge the exact session/digest/generation/record IDs/summaries. Only after a verified acknowledgement and a fresh policy/source/generation check does the second process receive the task and context. The host captures its final structured completion automatically. This is a read-only planning/observation adapter; it does not authorize application edits. A verified acknowledgement is protocol evidence that the first client consumed the supplied references, not proof of internal reasoning or compliance by the second process.

Receipts include schema version, canonical repository, principal, task, source revision, full indexed provenance, result IDs in the context bundle, context digest, client/adapter version, acknowledgement timestamp, delivery outcome, attempts, completion hash and intake receipts. Prepare-only is explicitly unconsumed. Client unavailable, interrupted/timeout, nonzero exit, malformed output, invalid acknowledgement, blocked context and failed intake remain distinct durable states. Client phases have a 120-second timeout and bounded output; no raw stderr is copied into receipts or protocol stdout.

Completion JSON requires `schema_version:1`, `session_id`, `context_digest`, `outcome`, and `markdown`. Use `outcome:"no-learning", markdown:null`, or `outcome:"learning"` with one complete candidate Markdown string. Unknown fields and inconsistent outcomes are rejected. Completion bytes are pinned before intake; changed artifacts conflict. Replays preserve the durable result; learning uses a stable session idempotency key. Resume retries capture without relaunching after an intake failure, with at most three launch attempts and three capture attempts across restarts. Automatic unbounded retries are not used. Session locks remain after a hard kill: inspect the process/artifacts before manually removing a stale lock. Failed artifacts are retained for operator review.

## Verification

`npx tsx scripts/verify-session-client.ts` explicitly invokes the authenticated real Codex client on a fresh isolated Git fixture with a spaced path. It verifies policy acknowledgement before task release, real learning and no-learning completion, replay without duplicate intake, unchanged source and ownership-preserving uninstall. It consumes normal client service usage and is not run by unit tests or installation. The [recorded Windows check](evaluations/aef-012-client-verification.json) verifies Codex `0.162.0-alpha.17.2` with Node `24.16.0`. The candidate/policy are explicitly fictional protocol fixtures, not discoveries about a real project. [Test-first evidence](aef-011-012-tdd.md) separately records mocked launcher faults, filesystem/SQLite integration tests, coverage and required checks.
