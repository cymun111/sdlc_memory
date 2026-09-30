# Engineering Knowledge

Agent-agnostic engineering knowledge repository starter. Git is intended to be authoritative for published records and candidates; SQLite is a disposable derived index. The original requirements are preserved in [docs/PRD.md](docs/PRD.md).

## Quick start

Requirements: Node.js 24 LTS and npm. SQLite uses Node's built-in `node:sqlite` binding with FTS5; this Node API is currently experimental.

```sh
npm ci
npm run build
npm run knowledge -- init
npm run knowledge -- validate
npm run knowledge -- index --full
npm test
npm run smoke:mcp
```

Run `npm run knowledge -- serve --transport stdio` to expose six MCP tool contracts. The current tool handlers report `NOT_IMPLEMENTED`; they are not production retrieval or capture. The starter CLI supports local fixture validation/indexing/search and writes local candidate files with exclusive creation. Use `npm run knowledge -- help` for the command list.

## Repository status

This is a buildable foundation, not a completed V1. SQLite schema creation, fixture indexing, FTS lookup, front-matter validation, basic candidate file writing, stdio MCP discovery, and event-name allowlisting are implemented. Sample records and registry entries are fictional test fixtures, not claims about real repositories, and must not be promoted as evidence.

Not implemented: authenticated Streamable HTTP, complete ACL enforcement, response/token/byte budgets, graph traversal, durable idempotent submission queue, Git branch/PR writer, owner review/publishing, source evidence verification/freshness, atomic index generations and incremental parity, real hook receipts/retries/installation, production source-change workflow, credential administration, verified Codex/Claude Code/Cursor integration, end-to-end remote capture, 30-task retrieval evaluation, and measured performance report. Do not describe acceptance criteria as passed until their checks exist and run.

## Layout

- `knowledge/` published record fixtures grouped by scope
- `candidates/` candidate intake area
- `registry/`, `schemas/`, `templates/` versioned contracts and authoring assets
- `src/` TypeScript modules for validation, capture, indexing, retrieval, MCP, CLI, and hooks
- `integrations/`, `hooks/`, `.github/workflows/` integration scaffolds, not automatically installed
- `docs/` setup guides and full PRD

See [docs/setup.md](docs/setup.md), [docs/agent-onboarding.md](docs/agent-onboarding.md), and [docs/hooks.md](docs/hooks.md). No Git repository is initialized by this scaffold.
