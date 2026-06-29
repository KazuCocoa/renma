---
name: release-prep
description: Prepare a Renma release by checking git history, changelog, package metadata, docs, release notes, and dogfooding Renma CLI reports before producing release-ready artifacts.
id: skill.release-prep
title: Release Prep
version: 0.1.0
owner: maintainers
status: experimental
tags:
  - release
  - maintenance
  - dogfooding
requires_context:
  - context.release.prep
optional_context:
conflicts:
allowed_data: disclosed
network_allowed: true
external_upload_allowed: false
secrets_allowed: false
requires_human_approval: true
forbidden_inputs:
  - secrets
  - credentials
  - tokens
---

# Release Prep

## Purpose

Use this skill to prepare a Renma release from a local checkout. It routes the agent to the release-prep workflow and requires Renma's own reports as release evidence.

## Do Not Use For

- Distribution work or remote repository changes unless the user separately asks for those actions.
- General changelog cleanup that is not part of release preparation.

## Required Inputs

- Target version or release intent, such as patch, minor, major, or prerelease.
- The base ref for release comparison, usually the latest `v*` tag.
- Any known release theme, blockers, or user-facing changes.

## Instructions

1. Read `context.release.prep`.
2. Inspect the requested release scope and latest release tag.
3. Dogfood Renma before and after release artifact edits.
4. Prepare only the release-ready files needed for the requested version.
5. When the user asks for release finalization, create the local version commit and tag.
6. Report changed artifacts, exact validation commands, blockers, commit, and tag name.

## Constraints

- Keep recommendations grounded in provided inputs and repository evidence.
- Do not invent domain facts, policies, owners, dependencies, or product behavior.
- Prefer local `node dist/index.js ...` commands for dogfooding this checkout over installed global binaries.

## Completion Criteria

- Release metadata, changelog, docs, and release notes are consistent for the target version.
- Required Renma reports have been run or any skipped report is explained.
- The final handoff names blockers, residual risks, and the local commit/tag state.

## Validation

- Run the validation commands listed in `context.release.prep`.
