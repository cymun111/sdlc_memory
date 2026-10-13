# Conflict visibility, policy review, and scoped records

AEF-004 implements local conflict visibility, explicit historical inspection, mandatory-policy review gates, and structural metadata projection. It does not authenticate a shared deployment, verify remote approval events, infer contradictions from prose, or complete SDLC Command integration.

## Planning outcomes

`get_task_context` and the application facade return one of:

| Status | Meaning | Workflow action |
| --- | --- | --- |
| `ok` | Applicable mandatory policies fit and no policy blocker was detected | Context is eligible for planning; verify claims against current source |
| `POLICY_REVIEW_REQUIRED` | An applicable policy is disputed, conflicted, overdue, missing explicit approval evidence, or its source evidence is stale/dirty/unknown/unchecked | Block planning and request owner review or source revalidation |
| `CONTEXT_BUDGET_EXCEEDED` | Required policy context, conflict expansion, or follow-up references cannot fit configured limits | Block planning; adjust budgets or perform focused follow-up |

An empty result is still successful only when no applicable policy blocker exists. A policy with stale evidence is not silently removed from the required-policy set. Verified stale policies may appear as review context with `normative: false`; disputed policies remain out of ordinary results but are identified by authorized `policy_issues` references. Superseded policies are no longer required. More required verified policies than the result limit produces budget failure, not oversized success.

`policy_issues` contains bounded `{id, reason}` values: `needs_revalidation`, `dirty_worktree`, `unknown`, `revision_not_checked`, `approval_evidence_unavailable`, `disputed`, `conflict`, or `review_due`. Multiple reasons can apply. Check the whole bundle's status before launching work; a clean individual record does not override another policy's blocker. The existing session launcher rejects non-`ok` context before launch; real native-client delivery remains AEF-012 work.

Policies require explicit projected decision evidence: an HTTP(S) URL without embedded credentials, an approver, and a valid non-future approval timestamp. This checks declared evidence shape within locally verified records; it is not proof of a remote approval or a cryptographic identity check. Missing/unsupported approval metadata requires review. Due or invalid `review_after` values require review. Code freshness requires a caller-provided revision for the relevant repository; source checks do not establish semantic correctness. Unverified test-result artifacts remain `unknown`. Filtering one code/test source cannot turn the remaining evidence into a complete fresh-policy claim.

## Conflict references

The response retains `unresolved_conflicts` as stable IDs and adds `conflicts` entries with `{id, record_ids, source}`. Sources are:

- `report`: an unresolved, schema-valid report under an allowed registered repository's candidate directory;
- `relationship`: an explicit `contradicts` edge between distinct applicable published records, represented by a deterministic pair ID.

Reports are unreviewed claims, not new verified facts. Retrieval does not change published editorial status or automatically decide which side is correct. Applicable approved policies involved in conflicts block planning. Other conflicted records carry `requires_review: true`. Accessible counterpart records are considered together, including conflicts discovered through graph neighbors; result/byte/token/visit limits still apply. Conflict closure is capped by the configured visit limit. If safe expansion cannot complete, return a blocking budget outcome rather than unbounded traversal.

All report participants must be visible in the request's applicable scope before its ID, references, or counts are returned. Mixed-access groups are omitted completely. No report explanation, evidence payload, submitter, or absolute filename is returned in ordinary retrieval. At most 12 conflict references and 12 issue entries are serialized; `truncated` and authorized `omitted_conflict_count` identify incomplete metadata. A blocked status remains blocked even when details are truncated.

Report state is live candidate-file state, separate from immutable indexed knowledge provenance. Resolution can therefore change retrieval without an index rebuild. Do not cache policy/context decisions solely by index generation; AEF-019 must account for conflict state and source freshness. No automatic semantic contradiction detection or last-write-wins resolution is implemented.

Optional missing conflict directories mean no reports. Unreadable directories, links, malformed/oversized JSON, identity mismatches, or invalid owner-resolution metadata return sanitized `CONFLICT_STATE_UNAVAILABLE`; they never establish an empty, successful conflict scan. Read operations do not initialize or mutate the submission ledger.

## Historical reads and structural projection

Ordinary search, graph results, and direct reads exclude disputed/superseded records. Explicit inspection:

```sh
npm run knowledge -- get --id example.old-policy --repo example-app --include-history
```

MCP: `get_knowledge` with `include_history: true`. This flag permits authorized disputed/superseded references only; it never exposes candidates, rejected records, or denied scopes. Returned summaries include `editorial_status`, `normative`, and `requires_review`. `normative` applies only to eligible verified policies; other records are reference data. Historical records are always non-normative.

Access/applicability filtering precedes parsing denied record bodies. Cross-repository scope IDs are projected to the principal's configured repository allowlist. Relationships/supersedes/knowledge references retain only readable target IDs. Evidence uses known source-field allowlists: registered safe relative code/test references, safe document references, and explicit decision metadata. Unknown fields and denied repositories are omitted before serialization, including reconstructed Markdown front matter.

Direct reads return `redacted: true` when their header was projected and `historical: true` for historical records. A projected body is reference text, not the canonical record to resubmit or approve; its scope can have fewer members than an authored record permits. Body byte limits are validated and UTF-8 cuts do not introduce replacement characters.

This is structural projection, not classification of arbitrary prose. Titles, summaries, tags, narrative paragraphs, approval labels, and URLs in an otherwise authorized record must be classified correctly by authors/reviewers. The service cannot reliably infer every private name or secret embedded in free text. Treat all recalled text as untrusted evidence, never executable instructions or permission to act. Shared authentication and richer evidence verification remain separate features.

## Local owner review

Inspect the report and use its current SHA-256 hash:

```sh
npm run knowledge -- conflict inspect <report-id> --repo example-app
npm run knowledge -- conflict resolve <report-id> --repo example-app --expected-hash <hash> --reason "Reviewed the evidence"
npm run knowledge -- conflict reject <report-id> --repo example-app --expected-hash <hash> --reason "Report was not supported"
```

The configured principal and local owner must both match the registered report repository's owner. Owner inspection is explicit and uses the principal's full registered allowlist, allowing legitimate cross-repository review without granting access to unregistered records. Authorization is checked again after asynchronous evidence inspection. Requests, files, and resolutions are schema-validated and byte-bounded. Report IDs, canonical repository identity, and safe paths are checked. Expected hashes reject stale review; a local exclusive review lock prevents simultaneous supported replacements. Resolution records the trusted owner, timestamp, and reason, retains the report, and updates its candidate worktree file atomically.

Resolving/rejecting a report clears that report's live reference. It does not approve a candidate, modify published knowledge, remove curated contradiction edges, refresh an index, commit to Git, or establish protected-branch publication. Curated edges require reviewed record changes. Report files are the authoritative local state; SQLite receipt rows are not used to infer resolution. The initial schema accepts existing legacy reports without version/repository fields when directory/ID identity is valid.

A crash can leave a `.lock` file. Review the interrupted operation before manually removing that specific lock; no automatic recovery/sweeping or power-loss guarantee is claimed. Malformed files require owner repair; do not bypass a state error by treating it as no conflicts. Full Git governance and multi-process recovery remain AEF-015/AEF-011 work.

## Budgets and compatibility

Task-context accounting includes conflict/policy metadata and the MCP `{ok,data}` envelope. Token estimates use conservative UTF-8 bytes divided by three; the serialized byte cap and result/visit caps also apply. A policy overflow returns bounded `omitted_mandatory_ids` when the failure bundle fits. If even minimal metadata cannot fit, return a structured `CONTEXT_BUDGET_EXCEEDED` error rather than success; the minimum error envelope is necessarily exempt from impossible caller-sized limits. Full-body/search/graph envelope budgeting and progressive pagination remain AEF-010 work.

The nine MCP tool names remain unchanged. `include_history` is an optional read parameter; summaries/context gain fields and a blocking status. SDK conflict receipts no longer include an absolute host path. Strict facade consumers must update output validators and handle every non-`ok` status. Rebuild and restart clients after upgrading; no additional index migration beyond AEF-003 is needed.

Validate with build, typecheck, tests, fixture validation, stdio smoke, and `npm run coverage:aef-004`. See [test-first evidence](aef-004-tdd.md).
