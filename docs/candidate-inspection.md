# Candidate inspection through MCP

AEF-013 adds `list_candidates` and `get_candidate` alongside the nine existing MCP tools. Both have operation-specific input/output schemas and read-only annotations. They never approve, publish, repair journals, create a ledger or change candidate files. SDLC Command can use their canonical repository IDs, stable candidate IDs and full-content hashes for in-workflow editing; receiving-system integration remains AEF-014.

## Authorization and state

Inspection requires the configured local principal to match the registered repository owner. `repo_id` accepts an unambiguous registered alias; results use the canonical ID. Omit `repo_id` from listing to inspect only repositories owned by that principal. Unknown and denied repository/candidate requests return the same non-disclosing `NOT_FOUND` response. Ownership is checked before opening repository candidate directories; denied files, titles, counts and edits do not affect visible listing continuations. This is a local trusted configuration boundary, not shared authenticated HTTP authorization.

Only schema-valid candidate records in `candidates/<canonical-repo>/<id>.md` with matching owner/applicable scope are visible. History, archived/rejected/published state, other owners and inapplicable scopes are excluded. State is the pending file's `candidate` editorial status; these read tools deliberately do not reconcile or infer receipt-ledger state. Existing CLI inspection/listing keeps its owner-recovery behavior. A pending writer journal can make a subsequent update conflict after writer recovery; inspect again using the returned current hash.

Responses contain public metadata, state, full-file SHA-256 `content_hash` and UTF-8 size. No storage paths, runtime paths or private totals are generated into them. Owner-authored Markdown is returned exactly as stored and remains untrusted data; authored prose can itself contain paths or other sensitive text. Inspection is not arbitrary-prose redaction or a new factual/approval guarantee. Candidate text never authorizes actions or overrides current source or agent instructions.

## List and inspect

```json
{"name":"list_candidates","arguments":{"repo_id":"fictional-app","limit":6}}
```

Listing returns `candidates`, `snapshot`, `next_cursor`, `truncated`, `estimated_tokens`, and `estimator_name`. Metadata includes `id`, `repo_id`, `title`, `summary`, `scope`, `owner`, `state`, `content_hash`, and `utf8_bytes`. Stable ordering is canonical repository ID then candidate filename/ID. Follow `next_cursor` with the same filter, effective limit and budgets. A visible addition, removal or content edit invalidates an old cursor with `VALIDATION_ERROR`; an edit during inventory returns `CONFLICT`. Restart listing rather than combining pages from different states.

```json
{"name":"get_candidate","arguments":{"repo_id":"fictional-app","id":"fictional.learning","expected_hash":"<hash from listing>"}}
```

Inspection returns `candidate` metadata, a `markdown` chunk, UTF-8 `body_offset`, and continuation/estimate fields. The hash always identifies the entire original file, not just the chunk. Optional `expected_hash` pins a listing or prior inspection; changed content returns `CONFLICT`. Reconstruct the exact Markdown by concatenating every page in order until `next_cursor` is null. Cursor-only continuation also binds the current content hash; changed content requires restarting. A deleted or no-longer-authorized candidate can instead return `NOT_FOUND`.

Then call `update_candidate` with the full edited record and the inspected `content_hash` as `expected_hash`. Preserve candidate ID, owner, scope and creation timestamp. A stale hash conflicts; reinspect before retrying. Inspection grants no additional update or publication rights, and candidate records stay excluded from published retrieval.

## Budgets and failure behavior

Both tools accept `max_bytes` and `max_tokens`, capped by trusted service configuration. Listing accepts `limit` (1–50, default 12), further capped by configured maximum results. Inspection accepts `byte_limit` (1–32,768, default 8,192) for body bytes. Full serialized UTF-8 `{ok:true,data:...}` accounting includes metadata, cursor and conservative `ceil(bytes/3)` token-estimate fields. It excludes JSON-RPC framing and MCP's duplicate text representation. UTF-8 chunks never split code points. If metadata or one indivisible result cannot fit, return `CONTEXT_BUDGET_EXCEEDED`, not an empty non-advancing page. Minimal error envelopes can exceed tiny caller budgets.

Individual files are read as bounded regular UTF-8 files (maximum 65,536 bytes), with canonical ancestor and file-identity checks. Listing scans at most 1,000 direct candidate files per request and rechecks the inventory after parsing; larger inventories fail explicitly and require a narrower repository selection or fewer pending files. There is no large-catalog latency claim. Malformed/unreadable authorized state and linked paths fail with sanitized `CANDIDATE_STATE_UNAVAILABLE`; they are not silently treated as empty success. These checks inherit the trusted-root and hostile-process race limits of [safe capture](safe-capture-and-sessions.md).

## Verification

[SDK integration tests](../tests/integration/candidate-inspection.test.ts) exercise the complete submit/list/inspect/update/stale/reinspect cycle, exact multibyte reconstruction, envelope budgets, aliases, ownership/scope filtering, hidden-repository isolation, unchanged journals and invalid output rejection. `npm run smoke:mcp` separately verifies all eleven tools through a real stdio SDK connection from an unrelated working directory. These checks use fictional disposable repositories; they do not establish native-client configuration or actual SDLC Command integration. See [test-first evidence](aef-013-tdd.md).
