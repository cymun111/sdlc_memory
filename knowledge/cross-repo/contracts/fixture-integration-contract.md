---
schema_version: 1
id: fixture.cross-repo.contract
title: Fictional cross-repository contract fixture
summary: "Placeholder relationship fixture linking two fictional sample repositories."
type: overview
scope:
  kind: cross-repo
  repo_ids: [sdlc-command, worksheet-generator]
status: verified
owner: fixture-owner
sources:
  - kind: documentation
    reference: "fixture-only: sample fixture, not an actual shared contract"
relationships:
  - type: related-to
    target: fixture.sdlc-command.overview
  - type: related-to
    target: fixture.worksheet-generator.overview
created_at: "2026-09-30T00:00:00Z"
updated_at: "2026-09-30T00:00:00Z"
tags: [fixture, cross-repo]
---
# Fictional fixture only

This is test data for cross-repository scope parsing, not a real integration contract.
