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

Run `npm run knowledge -- serve --transport stdio` to expose seven service-backed MCP tools. Local retrieval, candidate intake, candidate updates, and conflict reporting are implemented. Use `npm run knowledge -- help` for the command list. On Windows PowerShell with script execution disabled, use `npm.cmd` in place of `npm`.

## Repository status

This is a local implementation milestone, not a completed V1. It includes schema validation, SQLite FTS retrieval, local repository registration, scope filtering, graph traversal, context budgets, staged index replacement, idempotent candidate receipts, local owner review, and a session launcher. These paths still need broader security and recovery coverage. Sample records and registry entries are fictional test fixtures, not claims about real repositories, and must not be promoted as evidence. Retrieval targeted at a registered application excludes those starter fixtures.

Not complete: authenticated Streamable HTTP, comprehensive ACL and budget verification, crash/concurrency recovery, Git branch/PR publishing, remote evidence verification, incremental indexing, real hook receipts/retries/installation, production source-change workflow, credential administration, verified Codex/Claude Code/Cursor integration, end-to-end remote capture, 30-task retrieval evaluation, and measured performance report. Local approval writes the knowledge worktree and refreshes the index; it does not establish protected-branch publication. The session launcher is implemented but real agent context delivery and automatic completion capture remain unverified. Do not describe acceptance criteria as passed until their checks exist and run.

`npm run smoke:mcp` starts the built CLI from another working directory against an isolated temporary checkout. An actual SDK client verifies seven-tool discovery, scoped task retrieval, direct reads, relationship traversal, denied reads, active generation identity, candidate submission/replay, updates with stale-hash rejection, and candidate exclusion. This tests local stdio only and leaves application repositories untouched. See [candidate editing](docs/review-and-publishing.md) for the `update_candidate` contract.

## Layout

- `knowledge/` published record fixtures grouped by scope
- `candidates/` candidate intake area
- `registry/`, `schemas/`, `templates/` versioned contracts and authoring assets
- `src/` TypeScript modules for validation, capture, indexing, retrieval, MCP, CLI, and hooks
- `integrations/`, `hooks/`, `.github/workflows/` integration scaffolds, not automatically installed
- `docs/` setup guides and full PRD

See [docs/setup.md](docs/setup.md), [docs/agent-onboarding.md](docs/agent-onboarding.md), and [docs/hooks.md](docs/hooks.md). No Git repository is initialized by this scaffold.
