# Snapshot provenance and checkout drift

AEF-003 makes the indexed snapshot authoritative for retrieval metadata. A query does not use the checkout's current HEAD to label older results. Current source remains authoritative for implementation behavior; snapshot identity establishes where indexed knowledge came from, not whether a claim is true today.

## Manifest and fingerprint rules

Each new generation stores a schema-validated manifest-v2 JSON object in `index_manifest.snapshot_json`, alongside its generation, commit, timestamp, and record count. The manifest records knowledge schema version 1, indexer version `knowledge-2`, build time, knowledge commit or null, source state, content fingerprint, and schema fingerprint. Readers validate consistency with the database's manifest columns; they do not repair metadata on read.

The SHA-256 content fingerprint hashes the JSON encoding of sorted `[repository-relative Markdown path, SHA-256 normalized body]` pairs. Normalize CRLF to LF; preserve other whitespace and the complete front matter/body. Sort paths by code-point comparison, independent of directory enumeration. Renames therefore change the fingerprint even if record IDs/bodies stay the same. The schema fingerprint hashes the normalized knowledge schema bytes separately; JSON formatting changes count as schema drift. Generation UUID and build timestamp identify a build; identical input trees retain their fingerprint across rebuilds.

Record counts remain in the stored manifest for integrity checks but are omitted from public snapshot metadata, avoiding disclosure of inaccessible records. Absolute source paths, record bodies, and source-file lists are not present in public manifests. Fingerprints describe the whole indexed input tree, not a per-principal knowledge subset.

## Build states and revision compatibility

| Source state | Meaning | `knowledge_revision` |
| --- | --- | --- |
| `clean` | Captured Markdown and schema match the referenced Git objects and relevant tracked source set | Indexed commit SHA |
| `dirty` | Versioned checkout with local source changes or input content not attributable to the referenced commit | `dirty:<content fingerprint>`; commit is retained as a base in the snapshot |
| `unversioned` | Selected root has no Git metadata; do not borrow an ancestor checkout's HEAD | `unversioned:<content fingerprint>`; commit null |
| `git_unavailable` | Git metadata/executable/history cannot establish a usable HEAD | `git_unavailable:<content fingerprint>`; commit null |

Clean/dirty classification concerns `knowledge/` and `schemas/knowledge.schema.json`, not unrelated application files, documentation, candidates, or ignored runtime artifacts. Clean attribution checks actual committed input bytes as well as Git status, including ignored/untracked Markdown that status alone could omit. New empty fixture trees can be indexed without a schema file using an explicit unavailable-schema fingerprint; nonempty records still require a valid captured schema.

Builders capture all Markdown and schema bytes, validate against those captured schema bytes, and populate SQLite from the captured record bodies. The schema compiler cache is keyed by content, not just pathname. Rechecks compare the complete input tree, schema fingerprint, and Git state before committing and immediately before switching the active generation. Detected additions, edits, deletions, schema changes, or HEAD/state changes return sanitized `INDEX_SOURCE_CHANGED`, preserve the prior generation, and record degraded build status. Retry after source activity settles.

This does not lock a participating repository or make its live worktree immutable. The committed snapshot remains bound to the bytes used even if a change happens after the last check; a later drift read reports the live difference. Arbitrary concurrent-writer serialization, power-loss durability, and automatic refresh remain separate work.

## Response and receipt fields

- `knowledge_snapshot` carries immutable indexed metadata, excluding global record count. `index_generation` and `knowledge_revision` agree with it.
- `checkout_drift` reports live `head_revision`, `head_changed`, and `content_changed`. State is `matched`, `changed`, or `unavailable`; unavailable checks use null rather than pretending false. Content drift includes schema bytes. This is a moment-in-time check, not continuous monitoring or proof of semantic freshness.
- `application_source` in task context pairs the canonical task repository ID with its caller-requested source revision, or null when unchecked. It is separate from the knowledge checkout's commit. Other repositories' evidence retains its own cited revision; one task revision is never applied to another repository's source.
- Discovery, direct reads, search, relationship expansion, task retrieval, facade readiness/prepared delivery, map reads, and prepared session receipts expose the indexed metadata. A map's `source_revision` still identifies that application's committed map source. Maps without an active knowledge index expose null knowledge metadata.
- CLI onboarding reports include snapshot/drift and a separately observed target `source_revision`; this does not establish completed onboarding or consumed context. CLI `status` now uses indexed `knowledge_revision` and separate live `checkout_revision`; `doctor` retains application `git_revision` separately.

Retrieval captures metadata once per request and reuses it for budget assembly, preventing repeated tree scans for each candidate and inconsistent drift readings within one response. Complete metadata counts toward existing task-context/discovery/map budgets. Full-body serialized caps and progressive generation-bound expansion remain AEF-010 work. Drift scans read the relevant local tree and Git metadata; no measured performance improvement or automatic refresh is claimed.

## Existing-index migration

An old generation without valid snapshot metadata returns `INDEX_REBUILD_REQUIRED`. Run:

```sh
npm run build
npm run knowledge -- index --full
npm run smoke:mcp
```

Use `npm.cmd` in PowerShell when required. Readers never retrofit a current HEAD onto old indexed content. A failed rebuild leaves the old generation untouched, but a legacy generation remains unreadable until a successful rebuild establishes provenance. Invalid new metadata returns `INDEX_UNAVAILABLE`.

Existing command names, MCP tool names, requests, and error envelopes remain unchanged. Snapshot/drift fields and two error codes are response extensions; facade consumers using strict output validators must update to the current schemas before consuming them. No automatic downgrade or invented legacy provenance is provided. `INDEX_SOURCE_CHANGED` is retryable after source stabilization; `INDEX_REBUILD_REQUIRED` is retryable after a full rebuild, not by repeating the same read.

Validation commands and scope: `npm run build`, `npm run typecheck`, `npm test`, `npm run validate:fixtures`, `npm run smoke:mcp`, and `npm run coverage:aef-003`. See [test-first evidence](aef-003-tdd.md). Coverage targets the new provenance module and writes ignored reports under `.runtime/coverage-aef-003/`.
