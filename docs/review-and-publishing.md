# Review and publishing

The intended lifecycle is candidate intake, owner review, and publication through a protected knowledge-repository branch. New submissions must not publish themselves or alter existing policy. Rejection should retain a reason; disputes and supersession must preserve history.

Local candidate submission, inspection, expected-hash approval, and rejection are implemented. Local approval changes the knowledge worktree and refreshes its index; it does not create a Git commit, protected-branch merge, or GitHub PR. Shared publishing and comprehensive multi-process review recovery remain unfinished.

## Editing a pending candidate through MCP

Use `knowledge candidate inspect <id> --repo <repo-id>` to read the Markdown and its `hash`, or use the `content_hash` returned by your most recent submission/update. There is currently no candidate-inspection MCP tool; an agent inspecting existing candidates needs CLI access or the inspected content supplied by the reviewer.

Call `update_candidate` with:

```json
{
  "repo_id": "sdlc-command",
  "id": "sdlc-command.example-learning",
  "expected_hash": "<64-character lowercase SHA-256 from inspection>",
  "learning": {
    "markdown": "<complete replacement Markdown with YAML front matter>"
  }
}
```

The configured local principal must match the registered repository owner. The replacement must pass the record schema, remain a candidate, and retain its ID, owner, scope, and creation timestamp. Update `updated_at` when correcting the content. The replacement is limited to 65,536 UTF-8 bytes. Schema validation does not establish factual accuracy or approval evidence.

The response retains the receipt ID and returns the new `content_hash`. Approval must use that new hash after review. Stale hashes, mismatched ledger/file content, and non-pending receipts are rejected. A successful update is not publication and remains excluded from normal retrieval. Repeating an old update request returns `CONFLICT`; inspect again before retrying. Sending identical content with the current hash is a no-op.

Original submission keys retain their original payload identity. Replaying the original submission returns its receipt with the current candidate hash without restoring old content. Sending changed content under the original submission key still fails; use `update_candidate` instead.

Updates use a durable SQLite journal and atomic file replacement. Opening the candidate ledger recovers interrupted replacements and synchronizes receipt hashes. If an external file edit conflicts with a pending journal entry, recovery fails visibly instead of overwriting that edit. Direct Markdown edits can make receipt hashes inconsistent and are not a supported substitute for this tool. Do not edit candidates concurrently through external filesystem tools or owner review commands.

Restart the MCP server/client connection after rebuilding to discover the added tool. The stdio smoke test exercises submission, update, stale-hash rejection, and original-submission replay using fictional temporary records.
