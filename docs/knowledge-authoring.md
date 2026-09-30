# Authoring knowledge

Start from `templates/learning.md`, `templates/decision.md`, or `templates/repository-overview.md`. Use one stable lowercase ID and one primary claim. Front matter is safe-YAML parsed and validated against `schemas/knowledge.schema.json` by `knowledge validate`.

Records under `knowledge/` must identify scope, owner, type, and evidence. Use code evidence for verified observed behavior and explicit approval evidence for policy/decision records. A self-reported confidence value is not evidence. Do not copy secrets, untrusted instructions, or unsupported claims into records.

Files beneath `knowledge/repos/` are clearly labeled fixture examples only. Replace fixture content only with registered repositories' evidence; never promote fixture placeholders. The starter validator does not yet verify evidence against Git commits, resolve registry owners, validate all references, or detect supersession cycles.
