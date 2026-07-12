---
id: context.release.prep
title: Release Prep Workflow
version: 0.1.0
owner: maintainers
status: stable
tags:
  - release
  - maintenance
  - dogfooding
when_to_use:
  - Preparing a Renma release from a local checkout
when_not_to_use:
  - Publishing packages or creating public releases remotely
allowed_data: public
network_allowed: true
external_upload_allowed: false
secrets_allowed: false
requires_human_approval: true
forbidden_inputs:
  - secrets
  - credentials
  - tokens
---

# Release Prep Workflow

## Summary

Renma release preparation is local-first and evidence-based. Use `tools/release-prep.mjs` for deterministic metadata checks, GitHub-ready release notes, Renma dogfooding reports, validation commands, and optional npm-version-style local commit/tag finalization.

## Scope

This context applies when:

- Preparing a new Renma release from a local checkout.
- Reconciling `CHANGELOG.md`, `package.json`, `package-lock.json`, docs, and release notes for a target version.
- Producing release evidence for review or CI.

This context does not apply when:

- Distribution work or remote repository changes.
- Updating unrelated historical release notes.
- Making general documentation edits outside a release-prep workflow.

## Release Inputs

- Target version or intended semantic-version increment.
- Base ref for release comparison, selected from repository history.
- Any known release theme, blockers, or user-facing changes.

## Workflow

1. Inspect `package.json`, `package-lock.json`, `CHANGELOG.md`, and release-relevant docs.
2. Run `node tools/release-prep.mjs --check-only` to check version, changelog, and base-tag consistency.
3. Edit release artifacts: version fields, changelog section/links, release notes, and docs affected by changed commands or diagnostics.
4. Run `node tools/release-prep.mjs --release-notes --version <version>` to generate the GitHub Release body from `CHANGELOG.md`. Add `--from <tag>` or `--to <ref>` when generating notes for an older tag or a non-default comparison range.
5. Run `node tools/release-prep.mjs` to execute tests, build, Renma scan/catalog/readiness/graph, diff, and CI report.
6. When requested, run `node tools/release-prep.mjs --finalize` to stage only intended release files and create the local version commit and annotated tag.
7. Hand off changed artifacts, generated release notes, validation results, blockers, residual risks, commit hash, and tag name.

## Constraints

- Do not invent domain facts, policies, owners, dependencies, or product behavior.
- Remote repository changes, package publication, and public release creation are outside this workflow unless the user separately requests them.
- Local version commits and local annotated tags are allowed when the user asks for release finalization.
- Do not rewrite unrelated release history while preparing the current release.
- Treat Renma findings at or above the requested failure threshold as release blockers unless the user explicitly accepts a documented suppression.
- Redact secrets, credentials, tokens, personal data, and proprietary values from release artifacts and shared logs.
- Prefer local `node dist/index.js ...` commands for dogfooding this checkout over installed global binaries.

## Validation

Run `node tools/release-prep.mjs`; use `--check-only` for metadata checks only, `--release-notes` for GitHub Release body generation, and `--finalize` for local commit/tag creation after validation.

## Completion Criteria

- Release metadata, changelog, docs, and release notes are consistent for the target version.
- GitHub-ready release notes are generated from `CHANGELOG.md` and the intended comparison range.
- Required Renma reports have been run, or any skipped report is explained.
- The final handoff names blockers, residual risks, and the local commit and tag state.
