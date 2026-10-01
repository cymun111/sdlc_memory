# Repository discovery (AEF-001)

Use MCP `list_repositories` or CLI `knowledge repos list` before selecting a repository for task retrieval. Both use the same read-only discovery service. No source checkout is scanned or changed.

## Inputs

| MCP argument | CLI option | Contract |
| --- | --- | --- |
| `query` | `--query` | Optional case-insensitive substring, maximum 200 characters; trimmed |
| `limit` | `--limit` | Integer 1–50; default 10 |
| `cursor` | `--cursor` | Opaque continuation token returned by the previous page |

Search matches canonical ID, configured name, configured aliases, and the selected overview summary. Results are sorted by canonical ID. Aliases match searches but do not create duplicate results or replace canonical IDs.

## Output

The MCP response uses the existing `{ok, data}` envelope; the CLI prints the data object:

```json
{
  "repositories": [
    {
      "id": "sample-app",
      "name": "sample-app",
      "description": null,
      "description_status": "unavailable",
      "evidence": null,
      "freshness": "unavailable"
    }
  ],
  "next_cursor": null,
  "index_generation": null,
  "index_status": "unavailable"
}
```

Registration supplies identity. An indexed `verified`, repository-scoped `overview` with nonempty sources supplies description text. Candidates, fixture records, records without sources, and unrelated scopes cannot supply it. When multiple eligible overviews exist, the lowest record ID is chosen deterministically. `evidence` contains its `record_id` and indexed `content_hash`; use `get_knowledge` with that ID and repository ID for details.

`freshness` is `revision_not_checked` for code references, `unknown` for other evidence, and `unavailable` without an overview. These labels do not assert factual correctness or live evidence verification. Missing index manifests allow identity-only discovery; corrupt manifests or unreadable active databases return `INDEX_UNAVAILABLE` with rebuild guidance.

## Access and pagination

The trusted local configuration's `repositories` list is the allowlist, matching existing local repository retrieval. Discovery queries only those repository scopes before selecting descriptions, searching, or paginating. It does not infer authorization from caller arguments, knowledge records, owner names, or the fictional YAML registry. This is not shared-service authentication or a new per-user ACL system. Restart a running MCP server after changing its local configuration.

Responses expose no configured checkout path, arbitrary source-reference fields, or graph neighbors. Published summary text remains author-provided reference data and should be reviewed before publication.

Pass `next_cursor` back with the same query and limit. Cursors bind to the principal, registered identities/aliases, index generation, and selected search results. Changes invalidate old cursors with `VALIDATION_ERROR`; restart without a cursor. Cursors are continuation markers, not authorization tokens.

The UTF-8 size of `{ok:true,data:...}` is capped by configured `budgets.maxBytes` (default 8192). Pages may contain fewer records than `limit`; always follow `next_cursor`. If one record or the response metadata cannot fit, return `CONTEXT_BUDGET_EXCEEDED`. This cap applies to the logical JSON envelope, not MCP transport framing or its duplicated text/structured representations.

## Verification and limits

`npm test` covers unrelated synthetic repositories, access filtering, alias search, missing descriptions/indexes, deterministic pagination, stale cursors, invalid limits, and byte budgets. `npm run smoke:mcp` checks actual SDK discovery, CLI parity from another working directory, and discovery followed by task retrieval. Run `npm run build` before the smoke test.

Language inventories, entry-point extraction, and detailed maps belong to AEF-002. Discovery currently uses the active index and local configuration; it does not fetch remotes or refresh the index automatically.
