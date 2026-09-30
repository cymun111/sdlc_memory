# Agent onboarding

## MCP status

The server uses the official TypeScript SDK and supports local stdio in this starter. Tool names and input schemas are exposed, but every handler returns `NOT_IMPLEMENTED`. Run `npm run build` then configure a client to launch Node directly with the absolute path to `dist/cli.js` and arguments `serve --transport stdio`; provide an explicit `KNOWLEDGE_ROOT` environment value. Restart the client after changing its MCP configuration.

The following examples are unverified templates, not compatibility claims. Confirm each product's current native configuration format before installing it. Never put credentials in committed client configuration. No remote HTTP endpoint is available in this starter.

Bootstrap agents should retrieve relevant knowledge before planning, check evidence/freshness against current code, submit explicit structured learnings with evidence, and report conflicts. These instructions do not guarantee a tool call. No transcript extraction is implemented.

| Adapter | Transport | Context delivery | Completion capture | Verification |
| --- | --- | --- | --- | --- |
| Codex | stdio template | Not verified | Not implemented | Unverified |
| Claude Code | stdio template | Not verified | Not implemented | Unverified |
| Cursor | stdio template | Not verified | Not implemented | Unverified |
