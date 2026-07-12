---
name: release-prep
description: Prepare a Renma release from a local checkout by checking repository history, changelog, package metadata, docs, release notes, and Renma CLI reports. Use when release-ready artifacts or validation evidence are needed, or when asked to generate or display GitHub Release notes for a Renma version. Do not use for distribution, remote repository changes, or unrelated changelog cleanup.
metadata:
  renma.id: skill.release-prep
  renma.title: Release Prep
  renma.version: "0.1.0"
  renma.owner: maintainers
  renma.status: stable
  renma.tags: '["release","maintenance","dogfooding"]'
  renma.requires-context: '["context.release.prep"]'
  renma.allowed-data: '["public"]'
  renma.network-allowed: "true"
  renma.external-upload-allowed: "false"
  renma.secrets-allowed: "false"
  renma.requires-human-approval: "true"
  renma.forbidden-inputs: '["secrets","credentials","tokens"]'
---

# Release Prep

Use this skill as the entrypoint for the required `context.release.prep` workflow.

## Routing

1. Read `context.release.prep` before preparing or changing release artifacts.
2. Follow its required inputs, workflow, constraints, validation, and completion criteria.
3. For a request to generate or display GitHub Release notes, run `node tools/release-prep.mjs --release-notes --version <version>` and return its Markdown output.
4. Use `tools/release-prep.mjs` for other operations only as directed by that context.
5. Return the release artifacts and evidence specified by the context.

## Hard Constraints

- For a release-notes-only request, do not finalize, commit, tag, push, or publish. Instead, return the generated Markdown and stop.
