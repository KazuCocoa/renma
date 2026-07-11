---
name: release-prep
description: Prepare a Renma release by validating repository evidence, version consistency, changelog readiness, and build artifacts. Use for reviewed local release preparation. Do not use for publishing packages, pushing tags, changing remote repositories, or unrelated changelog cleanup unless those actions are explicitly requested.
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
  renma.forbidden-inputs: '["credentials","customer data"]'
  renma.approved-network-destinations: '["registry.npmjs.org","github.com"]'
---

# Release Prep

## Use This Skill When

Use this skill when preparing a reviewed Renma release candidate from the local repository. It coordinates deterministic repository checks, version consistency, changelog readiness, build artifacts, and the release evidence a human maintainer needs before deciding whether to publish.

## Do Not Use For

- Publishing a package, creating or pushing a Git tag, or modifying a remote repository unless those actions are separately and explicitly requested.
- Guessing a release version, release scope, changelog content, or readiness state when repository evidence is incomplete.
- Unrelated changelog cleanup, dependency upgrades, feature work, or source refactors.

When one of these exclusions applies, stop at the reviewed local evidence boundary and report the missing decision or separately requested action.

## Required Inputs

- The repository state to review, including the current package version, changelog, lockfile, and relevant source changes.
- The intended release scope and target version from a maintainer or explicit repository evidence.
- Any project-specific release checklist or publishing policy referenced by the repository.

## Instructions

1. Read `contexts/release/prep.md` before changing release metadata.
2. Inspect the current repository status and confirm the intended release scope is explicit.
3. Verify package and lockfile version consistency.
4. Review the changelog for a matching release section and ensure entries reflect repository evidence.
5. Run the deterministic verification commands required by the release context.
6. Build the package and inspect the generated package contents before proposing publication.
7. Summarize evidence, unresolved decisions, and any blocked publication step for human approval.

## Context References

- Required: `context.release.prep` in `contexts/release/prep.md`.
- Load other contexts only when the release scope explicitly depends on them.

## Hard Constraints

- Do not invent release notes, versions, owners, publication targets, or policy exceptions.
- Do not publish, tag, push, or upload unless the user separately authorizes that exact action.
- Do not include credentials, customer data, or secrets in release artifacts or external requests.
- Stop and request a human decision when version evidence, changelog scope, or publication authority is ambiguous.

## Validation

- Run `npm run quality`.
- Run `npm test`.
- Run `npm run build`.
- Run `npm pack --dry-run` and inspect the package file list.
- Run `renma scan .` and confirm this skill remains Agent Skills compatible.
- Present the release evidence and blocked decisions to a human maintainer before any publication step.
