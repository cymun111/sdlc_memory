# Local setup

## Requirements

- Node.js 24 LTS and npm
- Windows, macOS, or Linux with a supported native build toolchain when a prebuilt `better-sqlite3` binary is unavailable

The index uses Node 24's built-in `node:sqlite` `DatabaseSync` binding with FTS5, avoiding a separate native npm module. Node currently marks this API experimental, so keep the Node 24 LTS runtime pinned and review API status before upgrading major versions. No LLM API key or remote service is needed for the fixture-only starter.

## Install and run

From the repository root:

```sh
npm ci
npm run build
npm run knowledge -- init
npm run knowledge -- validate
npm run knowledge -- index --full
npm run knowledge -- query "fixture"
npm run knowledge -- status
npm test
npm run smoke:mcp
```

Copy `.env.example` to an untracked `.env` and set `KNOWLEDGE_ROOT` to this repository's absolute path when the CLI is launched from another directory. The CLI currently reads process environment directly; automatic `.env` loading is not installed. `.runtime` is the default ignored local runtime directory. The fixture index is rebuildable.

## Current limits

Only `stdio` MCP serving is wired. `serve --transport http` fails explicitly. Submission writes a new local candidate only; it does not deduplicate, bind trusted identity, persist a receipt ledger, or open a pull request. `npm run smoke:mcp` verifies real SDK tool discovery, not retrieval correctness or end-to-end knowledge use.
