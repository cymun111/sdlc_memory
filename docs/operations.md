# Operations

The local index is disposable and can be rebuilt with `npm run knowledge -- index --full`. Keep `.runtime` ignored and back up the Git checkout and any future durable pending-submission store separately. The starter does not yet implement health diagnostics, index generations/rollback, durable pending writes, evidence reconciliation, credential rotation, audit retention, or replay commands.

If validation or indexing fails, preserve the last known Git state and inspect the error on stderr. Do not treat an empty/unavailable index as a successful retrieval. Before any shared deployment, implement and test restart recovery, backup restore, credential rotation, bounded retry, and degraded readiness reporting.
