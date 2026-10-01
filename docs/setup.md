# Local setup

## Requirements

- Node.js 24 LTS and npm
- Git and Windows, macOS, or Linux; no separate SQLite native build toolchain is required

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

Only `stdio` MCP serving is wired. `serve --transport http` fails explicitly. Candidate submission has a local receipt ledger and idempotency checks; updates use expected hashes. Local approval writes the knowledge worktree and refreshes the index without creating a Git commit or PR. The smoke test verifies discovery, scoped reads, relationships, candidate updates, conflicts, and replay using isolated fictional repositories. Native agent hooks and remote publishing remain unfinished.

## Reuse with another project

The knowledge checkout can have any directory name. Register each source Git checkout locally:

```sh
npm run knowledge -- register-repo --id sample-app --path /absolute/path/to/sample-app --owner local-owner --team local
npm run knowledge -- index --full
npm run knowledge -- query --repo sample-app --task "Understand the architecture"
```

Use `npm.cmd` on PowerShell if execution policy blocks `npm.ps1`. Registration stores paths, ownership, and repository membership in ignored `.runtime/config.json`. It does not modify the source repository. Existing configured aliases are retained; new repositories receive no implicit aliases.

From another working directory, invoke the absolute `dist/cli.js` path. Root selection uses `--root`, then `KNOWLEDGE_ROOT`, then the selected configuration's `knowledgeRoot`, then discovery relative to the executable's schema directory. No particular checkout name is required. `--config` or `KNOWLEDGE_CONFIG` selects a local JSON configuration. Administrative registration writes `.runtime/config.json` in the resolved root; an explicitly selected configuration remains an input file and is not rewritten.

The committed sample knowledge is fictional test data. Real project records under `knowledge/` and `candidates/` are Git-trackable, so stage changes explicitly when keeping a reusable tooling checkout separate from project knowledge. Never stage `.runtime`, generated databases, credentials, or private configuration.
