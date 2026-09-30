# Hooks

`hooks/defaults.yaml` and `schemas/hooks.schema.json` define the intended allowlisted lifecycle events. `src/hooks/dispatcher.ts` rejects unknown event names and dispatches only explicitly registered handlers; there is no shell-command execution from event payloads. Existing handler behavior is a placeholder.

No hooks are active merely because this repository contains templates. Durable event receipts, event deduplication, retries, `knowledge hooks install/doctor/replay/uninstall`, verified context injection, completion artifact submission, source-change reconciliation, and maintenance scheduling are not implemented. Agent integrations and source-repository workflows must be installed separately after validation. No native agent hook compatibility has been verified.

For future operation, each event must be authenticated, bounded, persisted before asynchronous acknowledgement, replayable after restart, and safe under at-least-once delivery. Session-start context does not replace task-specific retrieval; completion must consume explicit structured output, not claim transcript understanding.
