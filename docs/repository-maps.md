# Repository maps (AEF-002)

Repository maps are rebuildable local navigation artifacts, not approved knowledge records. They read a registered checkout's committed Git objects and write only `<knowledge-root>/.runtime/repository-maps/`. They never execute application scripts, modify source checkouts, or fetch remotes.

## Commands

```sh
npm run knowledge -- repos map build --repo sample-app
npm run knowledge -- repos map build --repo sample-app --revision <commit-or-local-ref>
npm run knowledge -- repos map show --repo sample-app
npm run knowledge -- repos map show --repo sample-app --section entry_points
npm run knowledge -- repos map show --repo sample-app --section files --path-prefix apps/ --limit 10
npm run knowledge -- repos map show --repo sample-app --section files --path-prefix apps/ --limit 10 --cursor "<next_cursor>"
```

Build defaults to HEAD and resolves references to an exact commit. Each successful build atomically replaces the latest map for that repository, even when building a historical revision. A failed build preserves the previous map. The source repository must have at least one commit. Use `npm.cmd` in PowerShell where execution policy blocks `npm.ps1`.

MCP `get_repository_map` accepts `repo_id`, optional `section`, `path_prefix`, `limit` (1–50, default 10), and `cursor`. It reads an existing map only. Use the CLI to build one first. Restart your MCP connection after installing this tool.

```json
{"repo_id":"sample-app","section":"entry_points","limit":10}
```

Default `section: "summary"` returns counts, up to 20 top-level directories, and extension-derived language names. Detailed sections: `files`, `packages`, `entry_points`, `commands`, `tests`, `languages`. Use returned relative file paths to inspect current source. Each item carries its evidence path and Git blob hash; the envelope supplies the full source commit and extractor version. These are Git content identifiers, not assertions that code works.

## What is extracted

- **Generic Git:** tracked text-file paths, directory groupings, extension-based languages, and test paths inferred from test/spec directory and filename conventions.
- **npm:** package boundaries from eligible tracked `package.json` files, including nested packages. Workspace declarations are reported, but glob expansion and declared workspace membership are not implemented.
- **Entry points:** safe tracked text-file targets explicitly declared by `main`, `module`, `types`, `bin`, and string export targets. This is a navigation inventory, not full Node export resolution. Missing, wildcard, generated, and excluded targets are omitted.
- **Commands:** conventional build/test/lint/dev/start/typecheck/format script names, expressed as `npm run <name>` with the package directory. Script bodies and arbitrary package metadata are not copied. Commands are reference data; inspect the original scripts before running them.
- **Other stacks:** generic maps only. No inferred module responsibilities, symbol index, call graph, framework detection, or language-specific package parsing.

## Safety and limits

Extraction excludes symlinks/submodules, Git-classified binaries, files over 1 MiB, unsupported extensions, common generated/vendor directories, lockfiles, and paths matching credential/secret/token/password/environment/key patterns. Filtering is conservative and may omit legitimate files; it is not a general secret detector. Map filenames and source paths remain repository data. Do not commit real credentials, even in otherwise eligible manifests.

Limits: 5,000 eligible files, 100 manifests, 64 KiB per manifest, 100 script names and entry targets per manifest, and bounded export nesting. Clipped inventories set `truncated`; malformed manifests produce warnings. Individual Git calls have a 15-second timeout and 8 MiB output cap; exceeding these limits fails explicitly rather than publishing a partial replacement.

The Zod contract in `src/retrieval/repository-map.ts` validates written and loaded artifacts. `schemas/repository-map.schema.json` documents the serialized contract. Maps are ignored runtime data and can be deleted and rebuilt; they are not submitted, approved, or included in knowledge indexing.

## Freshness, access, and pagination

Freshness is reported separately: `source_available`, `head_changed`, `dirty_worktree`, and `head_revision`. Dirty checks consider relevant tracked edits and untracked files using the path filter; ignored files are excluded. These flags describe checkout state, not line-level claim verification. A new HEAD may be unrelated to mapped files, so `head_changed` is deliberately conservative. Source read failures are explicit even when a cached map remains readable. Rebuild explicitly after source changes; background refresh belongs to AEF-006.

Only repositories registered in the trusted local configuration can be read. This is the same local allowlist as discovery, not shared-service authentication. Responses omit checkout filesystem paths. Moving registration to a different path requires rebuilding the map.

Cursors bind to the map, principal, section, path prefix, and limit. Keep those request arguments unchanged while following `next_cursor`. Rebuilds invalidate cursors; restart without the old cursor after `VALIDATION_ERROR`. The configured `budgets.maxBytes` limits the logical `{ok:true,data:...}` envelope; MCP framing and duplicated representations are outside this limit. Pages may be shorter than requested. If metadata or one item cannot fit, the tool returns `CONTEXT_BUDGET_EXCEEDED`.

## Verification

`tests/integration/repository-map.test.ts` covers packages, workspaces, non-Node files, malformed manifests, sensitive/binary/generated/oversized exclusions, evidence hashes, historical revisions, renames, unavailable source, allowlists, pagination, and response limits. `npm run smoke:mcp` builds a synthetic map via the CLI, discovers its repository through MCP, selects an entry-point file through `get_repository_map`, and checks CLI/MCP parity. No real project files are used as fixtures.
