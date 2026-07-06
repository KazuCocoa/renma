# Changelog

All notable changes to Renma are documented in this file.

This project follows the spirit of [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and uses semantic version tags.

## [Unreleased]

## [0.10.0] - 2026-07-05

### Added

- Added metadata budget diagnostics for oversized frontmatter and long metadata list items.
- Added shared context usage-boundary diagnostics for missing or placeholder `when_to_use` and `when_not_to_use` metadata.
- Added shared context language diagnostics for vague wording, relative currentness wording, and prompt/runtime-selection wording.
- Added shared context lifecycle diagnostics for deprecated assets, invalid `superseded_by` targets, and supersession cycles.
- Added context conflict graph diagnostics for invalid `conflicts` metadata and skills that require conflicting contexts.

### Changed

- Simplified security policy frontmatter handling around canonical snake_case metadata keys.
- Expanded diagnostics documentation for metadata budgets and shared context governance checks.

## [0.9.0] - 2026-07-03

### Added

- Added security posture summaries to readiness and CI reports, derived from existing security findings and `riskClass` metadata.
- Added effective security policy inventory summaries for readiness and CI reporting, derived from asset policy metadata, security profiles, and repository security config.
- Added security-aware semantic diff summaries that compare security finding posture and effective policy inventory across revisions.

### Changed

- Kept security posture reporting non-gating in v1; readiness score, readiness level, scan `fail_on`, and CI status semantics remain unchanged.
- Kept policy inventory reporting non-gating in v1; scan `fail_on`, readiness score/level, and CI status semantics remain unchanged.
- Kept security-aware diff reporting non-gating in v1; scan `fail_on`, readiness score/level, and CI status semantics remain unchanged.

## [0.8.1] - 2026-07-03

### Added

- Added a GitHub Actions workflow that publishes the npm package from version tags via npm trusted publishing.

## [0.8.0] - 2026-07-03

### Added

- Added `riskClass` to security scan findings so reviewers can distinguish `violation`, `suspicious`, and `advisory` results without changing severity thresholds.
- Added scan review signal docs and security policy taxonomy guidance for `severity`, `confidence`, and `riskClass`.

### Changed

- Surfaced risk classes in text scan output, readiness reports, semantic diffs, and CI reports.
- Added npm version and download badges to the README.

### Fixed

- Made semantic diff cleanup preserve primary snapshot errors while retrying temporary directory removal.

## [0.7.0] - 2026-07-02

### Changed

- Refined deterministic security diagnostics for agent-facing context assets without adding package or CI workflow scanning.
- Reduced false positives for guarded or defensive security guidance around destructive commands, privileged commands, remote script execution, unpinned installs, and external uploads.
- Clarified the 0.7.0-and-later roadmap: security diagnostics stabilization first, security posture summaries next, Trust Graph as deterministic repository evidence, and Repository Context BOM as a declared manifest rather than runtime usage telemetry.
- Added a user-manual quickstart for security policy metadata and reusable security profiles.
- Expanded the user manual with metadata authoring guidance, security policy examples, reusable security profile guidance, and common security diagnostic fixes for the 0.7.0 line.
- Added a first-skill authoring walkthrough that shows how to use scaffold, inspect, scan, graph, readiness, and LLM-assisted repair loops to create and refine skills.
- Added guidance for deriving related router skills from existing skills, including an Appium setup example.
- Split the expanded user manual into focused authoring and security policy guides while keeping the user manual as the CLI entrypoint.

## [0.6.1] - 2026-06-29

### Changed

- Updated the release-prep workflow to allow local version commits and annotated tags when release finalization is requested.
- Moved release-prep validation mechanics into a deterministic tool script to reduce skill/context token usage.

## [0.6.0] - 2026-06-29

### Added

- Added freshness diagnostics for context assets.
- Added suppressions for managing accepted diagnostics.
- Added the project changelog to document release history.
- Added a release-prep skill and context asset that dogfood Renma reports during release preparation.

### Changed

- Centralized diagnostic IDs in one module.
- Simplified the example spec and improved example README documentation.
- Updated package metadata so published packages include the changelog, license, and README.
- Clarified README layout and redaction wording so Renma's own scan reports stay clean.

## [0.5.1] - 2026-06-27

### Changed

- Modified README documentation.
- Included minor maintenance updates after the `0.5.0` release.

## [0.5.0] - 2026-06-26

### Added

- Added a bundled example context repository.
- Added field-level metadata and dependency evidence.
- Added command documentation guardrails to keep user-facing CLI docs aligned with implementation.
- Added smoke coverage for the example repository.

### Changed

- Improved CI report output.
- Linked the example repository from README and the User Manual.
- Expanded documentation and test coverage for the new example, metadata behavior, and docs synchronization.

## [0.4.0] - 2026-06-25

### Added

- Added scaffolding support for new context repository assets.
- Added focused graph views.
- Added scaffold output modes for file, prompt, and JSON output.

### Changed

- Improved metadata parsing for deterministic block-list fields.
- Required explicit owners for file scaffolding to avoid committing placeholder ownership.

## [0.3.0] - 2026-06-24

### Added

- Added security policy diagnostics and related configuration enhancements.
- Added checks for approved domains, disallowed commands, and contradictory policy guidance.
- Added security profiles in `renma.config.json`.
- Added simple block-list parsing for selected security policy fields.

### Changed

- Updated project planning documentation for the security policy work.
- Kept artifact-local explicit denials stricter than inherited repository or profile allowances.

## [0.2.0] - 2026-06-23

### Added

- Added repeated-context diagnostics.
- Added semantic diff reporting.
- Added CI report generation.
- Added a GitHub Actions example for generating and uploading a Renma CI report.

### Changed

- Updated planning documentation for security-related work.

## [0.1.1] - 2026-06-22

Tag-only release. No GitHub Release entry was published for this version.

### Changed

- Polished README and documentation.
- Updated package metadata for the early npm package release.

## [0.1.0] - 2026-06-22

### Added

- Added the initial Renma CLI for scanning agent-facing context repositories.
- Added catalog, ownership, graph, readiness, and reporting commands.
- Added workflow diagnostics for clarity, required inputs, completion criteria, optional context, and summaries.
- Added metadata governance, advisory diagnostics, local path checks, and semantic split suggestions.
- Added the initial project documentation, architecture notes, package metadata, tests, and license.

[Unreleased]: https://github.com/KazuCocoa/renma/compare/v0.10.0...HEAD
[0.10.0]: https://github.com/KazuCocoa/renma/compare/v0.9.0...v0.10.0
[0.9.0]: https://github.com/KazuCocoa/renma/compare/v0.8.1...v0.9.0
[0.8.1]: https://github.com/KazuCocoa/renma/compare/v0.8.0...v0.8.1
[0.8.0]: https://github.com/KazuCocoa/renma/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/KazuCocoa/renma/compare/v0.6.1...v0.7.0
[0.6.1]: https://github.com/KazuCocoa/renma/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/KazuCocoa/renma/compare/v0.5.1...v0.6.0
[0.5.1]: https://github.com/KazuCocoa/renma/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/KazuCocoa/renma/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/KazuCocoa/renma/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/KazuCocoa/renma/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/KazuCocoa/renma/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/KazuCocoa/renma/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/KazuCocoa/renma/releases/tag/v0.1.0
