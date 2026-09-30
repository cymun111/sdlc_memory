# Engineering Knowledge Repository PRD

Version: 1.1  
Date: September 30, 2026  
Status: Ready for implementation  
Proposed repository name: engineering-knowledge

## 1 Purpose and outcome

Build an agent-agnostic shared engineering knowledge system used across code repositories and team members. Agents retrieve a small, relevant context bundle before work and automatically submit durable discoveries during or after work. Team members review and maintain the same versioned records.

Git is authoritative for published knowledge and candidates. A graph and full-text search index are derived from those records and are rebuildable. Current application source code remains authoritative for implementation behavior. Retrieved knowledge must identify its evidence and freshness; it must never conceal disagreements with current code.

V1 must deliver an operational system, not only documentation or placeholder MCP tools. A developer must be able to run it locally, connect an MCP-compatible agent, query knowledge from multiple sample repositories, submit a learning, review it, publish it, and retrieve the updated context.

## 2 Users and primary stories

| User | Required outcome |
| --- | --- |
| Coding agent | Retrieve applicable standards, decisions, and repo facts within a response budget |
| Developer | Reuse discoveries made by other developers and agents |
| Knowledge owner | Review candidates, resolve conflicts, approve policies, and supersede old records |
| Maintainer | Register repositories, rebuild indexes, diagnose failures, and configure integrations |

Primary stories:

1. As an agent working in repo A, I receive shared, team, repo A, and relevant cross-repo knowledge without loading unrelated repo B documents.
2. As an agent, I submit an evidence-backed discovery once; retries do not create duplicates.
3. As an owner, I inspect a candidate and publish it through a reviewed pull request.
4. As a developer, I query the same knowledge through a CLI without using an agent.
5. As a maintainer, I update or delete a record and see its graph and search representation updated consistently.
6. As a team, we automatically capture learning artifacts committed alongside merged code changes.

## 3 Scope and defaults

### Required V1 capabilities

- Markdown knowledge records with YAML front matter and JSON Schema validation.
- Shared, team, repository, and cross-repository scopes.
- Candidate intake, deduplication, review, publication, dispute, and supersession.
- SQLite full-text search and graph node and edge tables.
- Real MCP tools and a human-facing CLI.
- Local stdio mode and a shared authenticated Streamable HTTP deployment mode.
- A working Git-based submission pipeline and participating-repo CI workflow.
- Incremental index updates with full rebuild and atomic generation switching.
- Evidence and freshness tracking.
- Configurable response budgets, traversal limits, access controls, and audit events.
- Setup documentation and agent bootstrap templates.
- Integration and retrieval evaluation tests.

### Out of scope for V1

- React dashboard.
- Dedicated graph database, vector database, embeddings, or LLM-based reranking.
- Full source-code symbol extraction or a complete call graph.
- Automatic interpretation of every agent conversation.
- Universal hooks guaranteed to work in every agent product.
- Autonomous modification of participating application code.
- Promotion of agent-generated organizational policies without owner review.
- Multiple organizations sharing one deployment.

These exclusions must not remove required automatic capture. V1 automatically handles explicit learning artifacts and submissions; it does not infer every useful fact from arbitrary transcripts.

### Implementation defaults

Use TypeScript in strict mode, Node.js on a supported LTS release selected at implementation time, npm with a lockfile, the official MCP TypeScript SDK, SQLite with FTS5, a safe YAML parser, JSON Schema validation, and Vitest. Use a maintained SQLite binding compatible with the selected Node release and document the choice. Pin exact installed dependency versions in the lockfile.

No runtime LLM API dependency is required. The agent producing a learning performs the summarization. The knowledge service performs deterministic validation, storage, indexing, and retrieval.

## 4 Architecture

Components:

- Git knowledge repository: published records, candidates, repository registry, templates, configuration schemas.
- Capture service: validates submissions and creates candidate changes.
- Git writer: serializes writes, uses isolated branches, and opens candidate pull requests in shared mode.
- Indexer: parses validated published records into SQLite nodes, edges, source references, scopes, and FTS entries.
- Retrieval service: filters access and scope, ranks matches, expands related records, and assembles bounded results.
- MCP server: exposes retrieval and submission tools using the same application services as the CLI.
- CLI: onboarding, validation, indexing, querying, candidate submission, and owner operations.
- CI: validates knowledge changes, enforces review, processes merged learning artifacts, and signals index refresh.

Shared deployment uses one persistent volume, one writer process, and read connections to the active index generation. Horizontal write scaling is a future feature. Shared instances must never each write their own independent canonical checkout.

Local mode uses an explicitly configured knowledge checkout. Connecting from an application repo must not cause writes into that application repo.

## 5 Repository structure

```text
engineering-knowledge/
  README.md
  AGENTS.md
  package.json
  package-lock.json
  tsconfig.json
  .gitignore
  .env.example
  knowledge/
    shared/
      standards/
      patterns/
      decisions/
    teams/
      platform/
        practices/
        decisions/
    repos/
      sdlc-command/
        overview.md
        architecture/
        decisions/
        learnings/
        troubleshooting/
      worksheet-generator/
        overview.md
        architecture/
        learnings/
    cross-repo/
      integrations/
      contracts/
  candidates/
    sdlc-command/
    worksheet-generator/
  registry/
    repositories.yaml
    principals.example.yaml
  schemas/
    knowledge.schema.json
    submission.schema.json
    repositories.schema.json
    config.schema.json
  templates/
    learning.md
    decision.md
    repository-overview.md
  src/
    core/
    capture/
    validation/
    git/
    indexing/
    retrieval/
    auth/
    audit/
    mcp/
      server.ts
      tools/
        get-task-context.ts
        search-knowledge.ts
        get-knowledge.ts
        get-related.ts
        submit-learning.ts
        report-conflict.ts
    cli.ts
  integrations/
    codex/
    claude-code/
    cursor/
    github/
      knowledge-capture.yml
  tests/
    unit/
    integration/
    retrieval/
    fixtures/
  docs/
    setup.md
    agent-onboarding.md
    knowledge-authoring.md
    review-and-publishing.md
    deployment.md
    operations.md
  Dockerfile
  compose.yaml
  .github/
    CODEOWNERS
    workflows/
      validate-knowledge.yml
      test.yml
      publish-index.yml
```

Sample records under named repositories are illustrative fixtures, clearly labeled. Do not invent facts about the user's actual projects.

Generated databases, credentials, caches, logs, and runtime audit files must not be committed. Runtime root defaults to an ignored .runtime directory in local mode and a configured persistent volume in shared mode.

## 6 Knowledge record contract

Every record is UTF-8 Markdown with YAML front matter, one stable identifier, one main claim or decision, and a concise summary. Arbitrary front matter object tags, executable content, and filesystem paths outside configured roots are rejected.

Required fields:

| Field | Contract |
| --- | --- |
| schema_version | Integer; initially 1 |
| id | Stable globally unique lowercase identifier; independent of filename |
| title | Human-readable title |
| summary | Concise summary, maximum 600 characters |
| type | observed-behavior, approved-policy, decision, practice, troubleshooting, or overview |
| scope | Object defining shared, team, repo, or cross-repo applicability |
| status | candidate, verified, disputed, superseded, or rejected |
| owner | Owner ID resolved through the registry |
| sources | Evidence references; required for verified claims and decisions |
| relationships | Zero or more typed references to stable record IDs |
| created_at | ISO 8601 timestamp |
| updated_at | ISO 8601 timestamp |

Optional fields include tags, supersedes, verification, applicability conditions, review_after, and conflict_refs.

Scope objects:

- shared: {kind: shared}
- team: {kind: team, team_id: platform}
- repo: {kind: repo, repo_id: payments-api}
- cross-repo: {kind: cross-repo, repo_ids: [payments-api, checkout-ui]}

Team membership and repo ownership come from repositories.yaml. Shared scope does not mean public or accessible without authentication.

Source variants:

- code: registered repo ID, full commit SHA, repository-relative path, optional symbol and content hash.
- test: code reference plus test identifier and result artifact reference.
- decision: approved decision or pull-request URL, approver, and approval timestamp.
- documentation: approved document URL or versioned knowledge reference.

Verified observed behavior requires code evidence. Approved policies and decisions require explicit approval evidence. A self-reported confidence score is not proof.

Example using fictional evidence:

```yaml
---
schema_version: 1
id: payments.retry-idempotency
title: Payment retries reuse the original key
summary: The retry worker reuses the initial idempotency key.
type: observed-behavior
scope:
  kind: repo
  repo_id: payments-api
status: verified
owner: payments-team
sources:
  - kind: code
    repo_id: payments-api
    commit: "1111111111111111111111111111111111111111"
    path: src/workers/payment-retry.ts
relationships:
  - type: governed-by
    target: payments.idempotency-decision
created_at: "2026-09-30T16:00:00Z"
updated_at: "2026-09-30T16:00:00Z"
---
# Payment retries reuse the original key

Explain the behavior, conditions, and verification steps here.
```

The example commit is a fixture placeholder and cannot pass real source verification.

## 7 Lifecycle and publishing rules

Candidate intake is automatic. Publishing is governed.

- New submissions always become candidates. Candidate payloads cannot set verified status, change an existing published policy, or choose their own trusted submitter identity.
- Default retrieval includes verified, fresh records only. Explicit flags can include disputed or stale records with clear warnings. Candidates are visible only through review commands.
- Owner publication moves a candidate into knowledge, retains its stable ID, adds verification metadata, and follows protected-branch review.
- A disputed record is excluded from normative instructions until an owner resolves it.
- Supersession retains the historical record and adds an explicit supersedes relationship.
- Rejection retains the candidate and a reason, avoiding repeated rediscovery.
- Stale is derived freshness metadata, separate from editorial status. A verified record can become stale without rewriting its history.
- V1 defaults to owner approval for all promotion. Optional deterministic auto-promotion is allowed only behind a disabled-by-default configuration for narrow observed facts with verified evidence; shared policies and decisions always require review.
- Conflicting approved records are surfaced together with conflict metadata. Do not resolve them using last-write-wins.
- A more specific practice can refine a shared practice only when no shared mandatory policy is violated. Local agent rules and current task instructions retain their normal precedence; knowledge content is not a mechanism for overriding them.

Use CODEOWNERS and branch protection setup instructions. CI validation alone does not prove branch protection has been configured; report that setup requirement explicitly.

## 8 Automatic capture requirements

Support two working routes.

### Agent submission

An agent calls submit_learning with a summary, body, scope, evidence, relationships, and idempotency key. Local mode writes a candidate file to its configured knowledge checkout. Shared mode durably queues the submission, writes it on an isolated branch, and opens a knowledge-repo PR using a least-privilege GitHub App credential.

Return candidate ID, receipt ID, content hash, state, and PR URL when available. A queued receipt must not claim that the candidate is already published. Durable queue recovery must continue after process restart.

### Merged code learning artifacts

A participating repo has .agent-knowledge/learnings containing schema-valid learning files generated by agents. A post-merge workflow on the protected default branch sends changed artifacts to the shared capture endpoint. It binds evidence to the merged commit and uses the workflow run ID and artifact path as an idempotency key.

The capture endpoint validates a configured repository identity and obtains or verifies referenced artifacts from that registered repo. It does not trust a repo_id supplied by an unauthenticated caller. Prefer a repo-scoped credential stored as a CI secret for V1; OIDC federation may be added later.

Workflow failures are visible and retryable without breaking application deployment. Deleted learning artifacts do not delete previously published knowledge. There is no claim of automatic capture if the agent never emits an artifact or calls the submission tool.

Deduplicate exact normalized claims by scope, type, and normalized claim hash. Preserve new evidence on repeated claims through an update candidate. Near matches are flagged using deterministic text similarity; they are not silently merged. Same idempotency key with different content returns CONFLICT.

Concurrent submissions use a serialized writer queue and unique IDs. Git push conflicts are rebased or retried with bounded attempts; exhausted retries retain a recoverable queued item.

## 9 Graph and indexing requirements

Graph nodes initially represent knowledge records, repositories, teams, source files, and source revisions. Relationships include applies-to, supported-by, depends-on, calls, governed-by, related-to, supersedes, and contradicts. V1 calls edges describe curated relationships, not a complete extracted call graph.

Store records, source references, membership, typed directed edges, record scopes, FTS entries, and an index manifest. The manifest identifies the knowledge Git commit, schema version, build timestamp, indexer version, record counts, and content hashes.

- Reject duplicate record IDs and invalid relationship types.
- Published record references must resolve. Cycles are permitted for related-to; supersedes chains must be acyclic.
- Index updates detect additions, edits, renames, deletions, and relationship changes by ID and hash.
- Removed records disappear from active search and their edges are removed.
- Build into a staging generation, validate it, then atomically switch the active manifest. Readers never see a partial generation.
- Failed builds preserve the previous active index and expose degraded status.
- Full rebuild and incremental rebuild must produce equivalent logical query results.
- The default branch is indexed for shared readers. Unmerged candidates are never added to published retrieval.
- Poll the knowledge remote every 60 seconds in shared mode, configurable; CI may request an earlier refresh. Local CLI can refresh immediately.
- No graph database is committed to Git.

## 10 Retrieval requirements

get_task_context accepts repo_id, task, optional topics, changed_paths, caller source_revision, and budgets.

Retrieval steps:

1. Authenticate caller and compute allowed scopes.
2. Apply access filters before ranking and graph traversal.
3. Include applicable mandatory policies within the requested scope.
4. Search task text and topics through FTS and exact tags.
5. Rank direct matches, repository specificity, verified evidence, and freshness using documented deterministic weights.
6. Expand relevant graph neighbors with configurable limits.
7. Deduplicate and assemble summaries and evidence into the response budget.

Defaults: 2,000 estimated tokens, maximum 8,000; 12 records; graph depth 1, maximum 2; no more than 50 visited nodes. Enforce server-side limits even when the caller requests larger values.

Use an explicit conservative tokenizer-independent estimator for V1 and return token_estimate plus estimator_name. Do not promise an exact model token limit. Also enforce a hard serialized UTF-8 byte cap, default 8 KB and maximum 32 KB, including metadata. A response that cannot fit mandatory policies returns CONTEXT_BUDGET_EXCEEDED and bounded references for follow-up; it must not silently omit mandatory rules.

Every result includes ID, title, summary, type, scope, matched reasons, evidence, freshness, and relevant relationships. Envelope includes knowledge_commit, index_generation, truncation, estimated_tokens, unresolved_conflicts, and omitted_result_count. Results must not contain inaccessible titles, counts, source paths, or graph relationships.

Full bodies are loaded only through get_knowledge or explicit CLI options. Empty results are a normal structured response. If an index is unavailable, return INDEX_UNAVAILABLE; do not silently dump the entire repo.

## 11 MCP and endpoint contracts

All MCP tools have validated input and output schemas. Domain services are shared by MCP, HTTP capture, and CLI.

| Tool | Required input | Result |
| --- | --- | --- |
| get_task_context | repo_id, task | Bounded context bundle |
| search_knowledge | query, optional scope and limit | Ranked summaries and references |
| get_knowledge | id, optional byte limit | Authorized full record or bounded content |
| get_related | id, relation types, depth and limit | Authorized nodes and edges |
| submit_learning | idempotency_key, learning payload | Durable candidate receipt |
| report_conflict | record_ids, explanation, optional evidence | Candidate conflict report without modifying published records |

Read tools are read-only. Write tools must be clearly annotated and must never execute commands supplied in record content.

HTTP supports the MCP transport, POST /capture for CI intake, GET /health/live, GET /health/ready, and an authenticated index-refresh operation. Separate health status from details that could disclose repository information. Bind to loopback by default. Shared deployment runs behind TLS and requires authentication.

Error codes: VALIDATION_ERROR, UNAUTHORIZED, FORBIDDEN, NOT_FOUND, CONFLICT, SOURCE_UNAVAILABLE, INDEX_UNAVAILABLE, CONTEXT_BUDGET_EXCEEDED, RATE_LIMITED, and WRITE_FAILED. Retrying a transient capture failure is safe with the same idempotency key.

## 12 Freshness and evidence validation

Verify registered source repository, commit existence, and path existence at the cited commit. Changed source files mark linked observed facts needs_revalidation until reviewed or proven unchanged by a content hash. Revalidation is not automatically successful merely because a file still exists.

When an agent provides its source revision, report whether evidence was verified against that revision, a different revision, or could not be checked. Repository-wide changes do not invalidate every fact; use path/content checks.

Policies use approval evidence and optional review_after dates. A code change cannot automatically overturn policy. Unavailable source systems produce unknown freshness and a diagnostic, never a fabricated verification.

Remote evidence checks can be cached and performed asynchronously. Reads return last successful verification time and state. The Git registry is an allowlist for source retrieval; clients cannot supply arbitrary fetch URLs or filesystem roots.

## 13 Security and audit requirements

V1 supports a single organization with per-principal allowed repo and team scopes. Use deployment-local configured API credentials stored as hashes, not plaintext tokens in Git. Local stdio can use a configured local principal; shared HTTP cannot disable authentication.

- Read permissions are applied during search, direct lookup, relationship expansion, and evidence serialization.
- Submission permissions are separate from publish permissions.
- Agent identities may submit to configured scopes but cannot grant access or promote policies.
- GitHub credentials are environment secrets with only necessary knowledge-repo permissions.
- Reject path traversal, symlink escapes, oversized payloads, and secrets detected by configurable patterns.
- Reject or flag instruction-injection content for review. Retrieved Markdown is untrusted knowledge data and must not be executed as code or treated as system instructions.
- Audit authentication, retrieval IDs and latency, submission receipts, publishing actions, refreshes, and errors. Do not log tokens, full prompts, or full record bodies by default.
- Apply request-size limits, configurable rate limits, and redacted errors.
- No team notification messages are sent automatically in V1.

## 14 CLI and agent onboarding

Required commands:

```text
knowledge init
knowledge register-repo
knowledge validate
knowledge index --full
knowledge index --incremental
knowledge query --repo <id> --task <text>
knowledge get <record-id>
knowledge submit --file <path> --idempotency-key <key>
knowledge candidates list
knowledge candidate approve <id> --expected-hash <hash>
knowledge candidate reject <id> --reason <text>
knowledge status
knowledge serve --transport stdio
knowledge serve --transport http
```

Mutating commands require an authorized principal. Approval creates a proposed knowledge change; it does not bypass remote branch protection. Local development may support publication into an isolated test checkout and must label that mode.

Provide documented setup templates for Codex, Claude Code, and Cursor. Verify current native configuration formats during implementation rather than assuming they are interchangeable. If an adapter cannot be verified, document it as manual setup without claiming compatibility tests passed.

Bootstrap instructions must tell agents to retrieve knowledge before planning, verify stale facts against code, submit durable discoveries with evidence, and report conflicts. Keep bootstrap files small; do not copy the full knowledge repository into agent instruction files.

Document an optional wrapper that performs initial retrieval and records a context receipt before launching an agent. Explain that instruction files alone cannot guarantee a tool call. No universal enforcement claim is permitted.

## 15 Measurable acceptance criteria

| ID | Criterion |
| --- | --- |
| AC01 | A fresh checkout installs, validates fixtures, builds, indexes, and starts without an LLM API key |
| AC02 | A real MCP client discovers tools and completes retrieval and submission calls |
| AC03 | Queries return applicable shared, team, repo, and cross-repo records without unauthorized results |
| AC04 | Traversal follows typed relationships and terminates within depth and node limits, including cyclic fixtures |
| AC05 | Context responses enforce estimated token, byte, result, and traversal budgets |
| AC06 | A valid submission produces a durable candidate receipt and a visible candidate change or PR |
| AC07 | Replaying intake does not duplicate candidates; mismatched idempotency content fails |
| AC08 | Candidate approval with stale expected_hash fails; approved publication requires configured owner workflow |
| AC09 | A participating-repo workflow sends merged learning artifacts end to end in a test GitHub setup |
| AC10 | Published edits become queryable within 120 seconds after successful remote sync under the documented deployment |
| AC11 | Renames preserve IDs; deletions remove results and obsolete graph edges |
| AC12 | Invalid source evidence cannot be promoted as verified; changed evidence reports revalidation needs |
| AC13 | Failed indexing preserves the last good generation and returns observable degraded status |
| AC14 | Concurrent submissions and a process restart lose no acknowledged candidate receipts |
| AC15 | Cross-scope search and graph expansion leak no inaccessible metadata |
| AC16 | Documentation supports a human CLI user and one verified agent onboarding path |
| AC17 | No credentials, generated databases, or invented real-project claims are committed |

Targets, not pre-established results: for 10,000 fixture records on a documented 2-vCPU, 4-GB RAM local SSD environment, aim for warm retrieval p95 below 500 ms excluding network and remote evidence checks, and a full rebuild below 60 seconds. Report actual measurements, hardware, dataset, and any deviations. No assumed percentage token savings.

## 16 Test and evaluation plan

Use meaningful tests at the schema, persistence, retrieval, and integration boundaries.

- Invalid schemas, scope mismatch, duplicate IDs, unresolved references, unsafe paths, and invalid supersession cycles.
- Candidate status exclusion, rejection, conflict reports, approvals, and expected-hash concurrency.
- Exact duplicate and repeated submission handling.
- ACL isolation on summaries, bodies, evidence, graph neighbors, and error responses.
- Budget overflow, mandatory-policy overflow, empty queries, and deterministic rankings.
- Full versus incremental index parity after additions, changes, deletions, and renames.
- Durable queue restart recovery and writer conflict recovery.
- Source revision checks, stale content, unavailable evidence, and expired policy reviews.
- MCP calls via an actual SDK client on both supported transports.
- HTTP authentication, capture endpoint idempotency, and secrets redaction.
- Golden retrieval fixture with at least 30 representative tasks and explicitly annotated applicable mandatory policies. Require 100 percent mandatory-policy recall for the fixture and at least 90 percent expected relevant-record coverage within default budgets. Design fixtures to fit; test overflow separately.
- Report response bytes and estimated tokens versus a naive full-document baseline on the same tasks. Include retrieval correctness so small responses alone do not count as success.

CI runs type checking, tests, build, schema checks, and fixture index construction. Performance evaluation can run separately but is required in the final delivery report.

## 17 Build phases and completion gates

| Phase | Share of build | Deliverable and gate |
| --- | --- | --- |
| 1 Foundation | 15 percent | Working TypeScript project, schemas, registry, templates, sample fixtures, validation |
| 2 Index and retrieval | 25 percent | SQLite graph and FTS, rebuilds, scope filters, budgets, golden evaluation |
| 3 MCP and CLI | 20 percent | Real tools, stdio and HTTP, auth, usable CLI, client integration tests |
| 4 Capture and publishing | 25 percent | Durable intake, Git writer, candidate review, source evidence, merged-artifact workflow |
| 5 Delivery and hardening | 15 percent | Container setup, security and recovery tests, onboarding, measured performance, operations guide |

The percentages represent proposed effort allocation, not current progress. Report completion based on passing gates. Do not call V1 complete with mocked production capture or placeholder graph traversal.

## 18 Operational requirements

Provide .env.example and validated configuration for checkout root, Git remote/default branch, runtime directory, polling interval, transport/port, budget caps, authentication, principal permissions, GitHub App credentials, and source allowlists.

Docker Compose starts a single service with persistent runtime storage. Development setup supports no remote services using fixture repositories. Real shared capture requires configured GitHub credentials and an actual destination repo; include a clear setup checklist.

Operations documentation covers backup of Git and pending submissions, rebuild of derived databases, rollback to a known knowledge commit, credential rotation, failed submissions, stale evidence, index degradation, and recovery after restart.

A health command identifies the active knowledge commit, index age, pending writes, source verification issues, and last build result for an authorized maintainer.

## 19 Implementation instructions for the receiving agent

Implement this PRD in an empty engineering-knowledge repository or a repository explicitly supplied by the user. Inspect existing files and AGENTS.md before modifying an existing project. Do not modify unrelated application repositories without authorization.

Proceed through the build phases. Use a short plan and keep implementation choices recorded in architecture decisions. Research current official SDK and agent configuration documentation when selecting APIs. Preserve this PRD as docs/PRD.md.

Choose routine details independently within these requirements. Ask only when a missing credential, unavailable external service, or incompatible existing constraint blocks the next necessary action. Continue offline implementation and tests while documenting blocked external validation.

Deliver:

- Working source code and lockfile.
- Fictional, clearly labeled fixtures covering multiple repos and scopes.
- Runnable setup commands, environment template, Docker configuration, and CI workflows.
- Real MCP and CLI integration tests.
- Verified automatic capture path and review/publish workflow.
- Retrieval quality and performance report with actual measured results.
- Documentation of adapter coverage and any external checks not completed.
- Final explanation of how agents read and contribute knowledge, with the precise steps remaining for deployment.

Definition of done: all functional acceptance criteria pass, required security and recovery checks pass, documented commands work from a clean checkout, and any externally blocked check is explicitly identified. An external block prevents claiming that particular integration is verified; it does not justify substituting fake success.

## 20 Automatic hook framework

This section is required V1 scope and extends the capture, freshness, and indexing requirements. The knowledge repository owns the hook handlers, configuration schema, adapter templates, installation commands, and tests. External agents and participating repositories invoke installed adapters; placing scripts in this repository alone does not activate external triggers.

### Hook locations and configuration

Add these paths to the repository structure:

```text
src/hooks/
  dispatcher.ts
  events.ts
  handlers/
    retrieve-context.ts
    capture-learning.ts
    validate-candidate.ts
    validate-knowledge-change.ts
    refresh-index.ts
    revalidate-sources.ts
    retry-pending.ts
schemas/hooks.schema.json
hooks/defaults.yaml
integrations/agents/
  adapters/
scripts/install-hooks.ts
docs/hooks.md
tests/integration/hooks/
```

Existing integrations/codex, integrations/claude-code, integrations/cursor, and integrations/github contain provider-specific configurations that invoke these common handlers. Avoid duplicate business logic in adapters.

hooks/defaults.yaml maps allowlisted event names to built-in handlers, enabled state, timeouts, retry limits, and failure policy. Do not accept arbitrary shell commands or executable code from webhook payloads or knowledge records. Runtime credentials and installation-specific values stay outside versioned defaults.

### Required events and behavior

| Event | Trigger source | Handler and required result |
| --- | --- | --- |
| agent.session.started | Verified native agent hook or launcher wrapper | Retrieve repository bootstrap context when task text is not yet available |
| agent.task.started | Agent adapter or workflow caller | Retrieve task-specific context and deliver it through a verified context-injection mechanism |
| agent.task.completed | Agent adapter or workflow caller | Validate and submit structured learning output, or record no-learning explicitly |
| candidate.received | Capture service after durable acceptance | Validate schema, evidence availability, duplicates, and conflicts; never publish automatically |
| knowledge.change.proposed | Knowledge-repo pull-request workflow | Validate changed records, scope, relationships, evidence requirements, and owner routing |
| knowledge.published | Knowledge-repo protected-branch merge | Refresh the index from the merged commit |
| source.changed | Registered source-repo default-branch workflow | Compare changed source paths and mark affected observed facts for revalidation |
| maintenance.tick | Service scheduler | Retry recoverable operations and check review dates and freshness |

A session-start query is not a substitute for task-specific retrieval. Completion hooks consume an explicit structured learning file or agent result; they must not claim to extract reliable learnings from arbitrary transcripts without an implemented extractor.

source.changed operates even when no learning artifact was added. Extend the participating-repo workflow to send changed paths, base/head revisions, and an authenticated repo identity. Handle renames, deleted files, merge commits, and force-push/rewrite situations by falling back to a full registered-source reconciliation when incremental comparison is unavailable.

### Hook event contract

Each event includes event_id, event_type, schema_version, occurred_at, repo_id when applicable, task_id/session_id when applicable, source_revision or knowledge_commit, and a bounded typed payload. The receiver derives trusted principal and source identity from authentication rather than caller-provided labels.

Persist an event receipt with deduplication identity, payload hash, attempts, state, timestamps, result references, and redacted error. Same event ID and payload is a safe replay; same ID and different payload is a conflict.

Handlers are at-least-once, idempotent, and recoverable after restart. Persist before acknowledging asynchronous acceptance. Processing another event cannot mutate an already published record without the publishing workflow.

### Context delivery and failure rules

Retrieval hooks return a bounded context bundle plus a receipt showing repository, task, knowledge commit, and result IDs. Adapters must demonstrate that the bundle reaches the agent's context. Writing a file or printing JSON without configuring the agent to consume it does not satisfy retrieval integration.

Default retrieval timeout is 5 seconds. A failed optional retrieval reports degraded operation and may continue; a deployment configured to require policy retrieval blocks task launch with a clear actionable error. Do not silently label empty or failed retrieval as successful context delivery.

Completion and freshness events enter a durable retry queue on transient failures. Use bounded exponential backoff, maximum 5 automatic attempts, then a visible failed state with an authorized replay command. Validation failures are terminal until corrected. Prevent feedback loops: index refresh and candidate receipt must not recursively generate submissions.

### Installation and verification

Provide knowledge hooks install --agent <adapter> --target <repo-path>, knowledge hooks doctor, and knowledge hooks replay <event-id>. Installation requires an explicitly selected target, previews proposed changes, preserves existing settings, and produces a reversible backup. Support --dry-run and an uninstall command that removes only integration-owned entries.

Verify currently supported hook events and configuration formats using official provider documentation during implementation. Do not invent native hooks for an unsupported agent. Where native task lifecycle hooks are unavailable, provide a working launcher wrapper and describe its limitations. At least one native adapter or launcher must pass an end-to-end context-delivery and capture test.

Hooks are triggered automatically after installation and service startup. Document separately which steps require source-repo workflow installation, agent configuration, scheduled service execution, and external credentials.

### Additional acceptance criteria

- AC18: Session/task integration demonstrably delivers scoped context to a real supported agent or test launcher before execution.
- AC19: Completion automatically submits structured discoveries and handles an explicit no-learning result.
- AC20: Candidate, PR, publish, source-change, and maintenance events invoke the correct handlers.
- AC21: Replayed and concurrent events do not duplicate candidates or corrupt an index generation.
- AC22: Acknowledged events survive restart; exhausted retries are visible and replayable.
- AC23: A source change with no learning artifact still triggers freshness checks.
- AC24: Hook installation preserves existing agent configuration and can be reversed.
- AC25: Forged event identities, unsafe payloads, and recursive trigger loops are rejected.

Hook implementation belongs in phases 3 and 4; installation, recovery, and end-to-end verification belong in phase 5. V1 cannot be declared complete with hook templates alone.

## 21 MCP setup and onboarding procedure

This is the required onboarding sequence the receiving agent must implement and document. Command names below define the intended interface; they are not claims that the repository has already been built.

### Step 1 Install and build

Document supported Node and OS versions, clone instructions, and exact dependency/build commands. Provide these npm scripts:

```bash
npm ci
npm run build
npm run knowledge -- init
npm run knowledge -- validate
npm run knowledge -- index --full
```

Define npm run knowledge as the built CLI entry point. Ensure commands work from a clean checkout. Clearly distinguish fictional development fixtures from production records.

### Step 2 Configure repositories and permissions

Copy .env.example into an untracked environment file and document how the launcher loads it. Configure the absolute knowledge checkout root, runtime root, registered source repositories, owners, transport, and permissions. Never assume the agent's current working directory is the knowledge checkout.

For local stdio, configure an explicit local principal with limited scopes. For shared HTTP, create credentials through an implemented administrative command; store only hashes in deployment-local principal configuration and securely distribute secrets outside Git.

Document required GitHub App installation and permissions for knowledge PR creation and source evidence reads. Retrieval-only local setup must work without those credentials. Candidate publishing and remote evidence checks must clearly report unavailable capabilities.

### Step 3 Start the MCP service

Local stdio:

```bash
npm run knowledge -- serve --transport stdio
```

The native MCP launcher must execute the built Node entry point directly, using an absolute path and explicit environment. Avoid npm lifecycle output on stdout. In stdio mode, stdout contains MCP protocol messages only; send diagnostics to stderr.

Shared service:

```bash
npm run knowledge -- serve --transport http
```

Provide exact deployed MCP endpoint path, port configuration, TLS reverse-proxy instructions, health checks, persistent-volume setup, and credential configuration. Do not expose unauthenticated shared service endpoints.

### Step 4 Connect an agent

Provide copyable, verified client-native setup examples for Codex, Claude Code, and Cursor in their integration folders. Each example must specify configuration location, launch command or remote URL, environment/authentication handling, server name, restart/reload instructions, and supported transport.

For local configuration, explain which process launches the stdio server and where its environment comes from. For HTTP, explain how client credentials are supplied and rotated. Never commit tokens into sample configuration.

Templates must be generated against the verified current configuration format of each client. Where a client is untested or cannot support the selected authentication/transport, label that limitation and provide a tested alternative instead of claiming compatibility.

### Step 5 Verify tool discovery and reads

Use an actual MCP SDK client smoke-test script, runnable through npm run smoke:mcp. It must discover all six required tools, invoke get_task_context for a fixture repo, load one authorized record, traverse a relationship, and verify that inaccessible scopes are excluded.

Confirm returned knowledge commit and index generation match the active index. Test local stdio and authenticated HTTP independently. The guide must explain how to diagnose missing tools, protocol-contaminated stdout, invalid paths, failed authentication, stale indexes, and budget errors.

### Step 6 Verify writes and publishing

Submit a fictional learning with an idempotency key. Confirm a durable receipt and candidate record or candidate PR. Repeat the same submission and verify no duplicate. Confirm the candidate is absent from ordinary published retrieval.

Approve the candidate through the authorized review workflow, merge the proposed publication, and verify that index refresh makes it queryable. The remote GitHub path requires a real test repository and credentials; a local simulation must be explicitly labeled and cannot establish remote verification.

### Step 7 Activate automatic hooks

Install the verified agent adapter or wrapper in an explicitly selected participating repo. Run hooks doctor, start a task, inspect its context receipt, finish with a structured learning artifact, and verify automatic intake.

Install the source-repo CI workflow and confirm a merged artifact reaches intake and a changed source file triggers revalidation. Configure the service maintenance scheduler. Document all installation steps once so future sessions and merges trigger automatically.

### Step 8 Handoff and ongoing operation

Provide a concise README quick start and detailed docs/setup.md, docs/agent-onboarding.md, docs/hooks.md, and docs/deployment.md. Include start/stop/restart, credentials, backups, rebuild, update, uninstall, and troubleshooting instructions.

Record a compatibility matrix with adapter, version tested, transport, retrieval delivery, completion capture, and verification status. Do not treat configuration generation as proof of successful connection.

Additional acceptance criteria:

- AC26: A new user can complete the local MCP setup with documented commands and no LLM API key.
- AC27: The smoke-test script proves discovery, scoped retrieval, relationships, and candidate submission.
- AC28: At least one agent connection is verified end to end; remaining adapter status is accurately documented.
- AC29: Shared HTTP setup verifies authentication, persistent storage, and index refresh.
- AC30: Documentation explicitly separates built functionality, installed hooks, and external integration checks still blocked.

