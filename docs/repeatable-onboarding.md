# Repeatable local onboarding (AEF-008)

SDLC Command can call `KnowledgeApplication.setup` as the final local repository-configuration operation. This standalone implementation composes registry configuration, committed-source maps, index rebuild/readiness, a manual stdio launch preview, and actual MCP SDK verification. It does not wire SDLC Command, edit application repositories, configure native clients automatically, or establish that an agent consumed context.

## CLI and facade

Build first. Select an explicit knowledge root and an absolute, separate source Git root. Quoted paths work on Windows, including spaces.

```powershell
npm run build
node dist/cli.js --root "C:\knowledge checkout" setup plan --id sample-app --path "C:\source app" --owner local-owner --team local
node dist/cli.js --root "C:\knowledge checkout" setup apply --id sample-app --path "C:\source app" --owner local-owner --team local
node dist/cli.js --root "C:\knowledge checkout" setup status --repo sample-app
node dist/cli.js --root "C:\knowledge checkout" setup uninstall --repo sample-app
```

`plan` validates roots and previews operations without creating settings or receipts. `apply` changes only knowledge-owned runtime storage. `--skip-service-verification` produces configured/pending verification states; it is not a successful connection check. `--client codex|claude-code|cursor` currently reports a degraded native adapter and supplies the same manual launch preview. It does not probe installation or claim that a native product connected. `manual` is the default supported client mode. Native configuration files remain untouched; a future adapter must prepare an exact change and obtain authorization before editing them.

The facade uses the same services directly, without parsing CLI output:

```ts
const result = await application.setup({
  contract_version: 1,
  mode: 'apply',
  transport: 'stdio',
  repository: { id: 'sample-app', path: '/absolute/source-app', owner: 'local-owner', team: 'local' },
  client: 'manual',
  verify_service: true,
});
const readiness = await application.readiness({ contract_version: 1, repo_id: result.repo_id });
// readiness.onboarding contains the durable setup evidence, if present.
```

`setupOutput` now accepts applied states and optional receipt/step/preview fields. `readinessOutput` adds optional `onboarding`; strict contract-v1 consumers must update output schemas. `uninstallRequest` is exported with the existing contracts. No MCP tool is added; the nine existing tool names remain stable. The `writes` collection is the plan's proposed write categories; applied results report actual step evidence instead.

## Validation and steps

Before mutation, validate contract version/transport/identity/owner/team, absolute canonical Git root with committed HEAD, separate canonical knowledge root with a schema, and the fixed knowledge-owned `.runtime/config.json`. Nested source directories, overlapping roots, ambiguous aliases, one path registered to another ID, and ID/path rebindings fail explicitly. Root/ancestor links are rejected before creating storage. Existing local principals/global owner roles are retained; onboarding does not accept caller authority fields.

Every receipt records six steps separately:

| Step | Completed evidence |
| --- | --- |
| Registration | Durable canonical ID/path/owner/team settings, preserving unrelated configuration |
| Map | Explicit committed-source build, exact revision and artifact hash |
| Index | Valid active generation built from captured knowledge/schema inputs |
| Client configuration | Knowledge-owned manual launch descriptor; native verification remains false |
| Tool discovery | Real stdio SDK handshake and presence of all nine current tools |
| Scoped read | Schema-valid task context for the canonical repository and requested source revision; applicable result scopes and unblocked status |

The server is launched with an absolute Node executable and built entry point, explicit root/config arguments, and no npm stdout. Each SDK request has a 10-second timeout. Private subprocess errors are replaced with bounded step diagnostics. Full service verification checks the server, not a native agent. Policy/budget blockers cause scoped-read verification to fail; review them through ordinary retrieval before retrying setup.

Missing knowledge/overviews remain unavailable. Successful empty task context is valid service verification, not proof of application facts. Description availability is supplied by the discovery service. A dirty checkout yields degraded setup while maps still describe committed source; setup never edits or commits source files.

## Reruns and recovery

Receipts and launch previews live under ignored `.runtime/onboarding/`; maps remain under `.runtime/repository-maps/`. Receipts record stable UUID, fingerprints, step attempts/states/timestamps, exact revisions/generations, ownership, and sanitized retry guidance. They are local operator data, not published knowledge. Receipt/launch reads are bounded to 128 KiB; map ownership reads permit 32 MiB.

Identical reruns reuse completed steps and the receipt UUID. Changed owner/team settings are allowed for a registration this setup owns, and invalidate registration/verification. Changed HEAD invalidates the map/verification; changed knowledge/schema inputs invalidate indexing; a newer active generation invalidates service verification; client-mode changes invalidate the descriptor step. Missing launch artifacts are regenerated. Externally changed owned registrations/previews cause conflict rather than silent adoption or overwrite. Fingerprints use canonical object-key ordering, so schema reordering does not create false ownership changes.

Step failures keep prior valid settings and active indexes, retain completed work, and return failed receipts with retry guidance. Repair the indicated input/service and rerun the same request. There is no whole-operation rollback: an initial registration can remain after a later index failure so retry can resume. Invalid roots/authority, ownership conflicts and lock rejection occur before new step work and return safe contract errors.

One exclusive local lock serializes setup/uninstall. Optimistic receipt/config checks reject changes while acquiring the lock. Locks are not swept automatically after crashes: an operator must establish no writer remains before removing a retained `.runtime/onboarding/setup.lock`. This is local serialization, not distributed locking or a general candidate-writer queue. Readiness is read-only and reports later source/index drift as degraded without rewriting the durable history. Recorded successful checks are snapshots, not continuous monitoring.

## Uninstall and limits

Uninstall removes only registration created by setup and unchanged owned launch/map artifacts. It preserves pre-existing registration/maps, global teams/principal/budgets, the shared index, unrelated files, and the receipt as an uninstalled audit record. It reloads current durable settings using an explicitly pinned configuration path, even when `KNOWLEDGE_CONFIG` points elsewhere. Externally changed owned artifacts/settings cause conflict. Linked map parents are rejected before removal, preventing existing links from redirecting deletion into source.

Local runtime roots remain trusted. Existing link guards and atomic file replacement do not prove cache/receipt authenticity or comprehensive concurrent filesystem replacement/power-loss recovery. Native client edits, shared authentication, receiving-system wiring, and verified task delivery are not implemented here. `context_delivery_verified` is always false; the reserved context-delivery state belongs to AEF-012. SDLC Command's actual adapter/migration is AEF-014, and the AEF-005 90% quality target remains an independent unmet gate.

See [TDD evidence](aef-008-tdd.md) and [integration contract](sdlc-command-integration.md).
