# Operations

The local index is disposable and can be rebuilt with `npm run knowledge -- index --full`. Keep `.runtime` ignored. Back up the authoritative Git checkout and durable pending-submission state separately. Generated databases and receipts must not be committed.

## Index failure and recovery behavior

Reads require an existing active generation and open SQLite read-only. Missing/corrupt manifests, generation mismatches, and unavailable/corrupt databases return `INDEX_UNAVAILABLE`; reads do not create an empty fallback database or repair schemas. Query and indexed-metadata failures return sanitized `INDEX_QUERY_FAILED`. Empty authorized matches remain successful empty results. These codes pass through the existing MCP error envelope and the versioned application facade; unknown or denied record identities return `NOT_FOUND`.

Rebuilds require an existing readable `knowledge/` root. An existing empty root is valid. Optional scope folders need not exist, but every directory discovered under the root must be readable; source links are rejected rather than silently omitting records. Unreadable directories/records return `INDEX_SOURCE_UNAVAILABLE`. Invalid Markdown, duplicate IDs, unresolved relationship/supersedes references, invalid relationship types, and cyclic supersession return `INDEX_VALIDATION_FAILED`. Related-to cycles and references to retained historical records are allowed.

Records are validated before writing a staged generation. The staged database is checked before the active manifest switches. Filesystem/transaction/switch failures return `INDEX_BUILD_FAILED`, leaving the previous manifest and generation intact. Failed attempts clean only their own staging, temporary-manifest, and unactivated database files. They never delete a prior generation or sweep arbitrary runtime files.

The schema-validated `.runtime/index-build-status.json` records the last completed attempt as `ready` or `degraded`, with its attempted generation, timestamp, and a bounded sanitized error. A degraded last attempt can coexist with a readable last-good index. This diagnostic is not an authenticated health endpoint or proof of current source freshness. It is best-effort when runtime storage itself cannot be written; the command still returns a failure. Status-write failure after a successful switch does not turn that switch into a failed operation.

On failure, inspect the error code and build status, fix unavailable sources or invalid records, and rerun a full rebuild. Query errors require checking/rebuilding the derived index. Repeated learning submissions must retain their idempotency key/body. Validation failures need corrected data; do not retry them blindly. No automatic retry loop is introduced by AEF-002.

Abrupt process termination can leave unreferenced attempt files; readers still use the active manifest. Automatic sweeping of earlier attempts, generation retention, concurrent-writer recovery, and power-loss durability remain follow-up work. AEF-002 tests controlled transaction and pre-switch interruption faults, not every hard-kill/storage failure.

Run `npm run coverage:aef-002` for the 80% aggregate coverage gate on indexing and graph-validation modules. Reports stay under ignored `.runtime/coverage-aef-002/`. This is feature coverage, not a claim of 80% repository-wide coverage.

If validation or indexing fails, preserve the last known Git state and inspect stderr. Before shared deployment, implement and verify authenticated health, full restart/concurrency recovery, backup restore, credential rotation, bounded retry, audit retention, and remote capture. Existing local generation switching does not establish these shared capabilities.
