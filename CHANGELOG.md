# Changelog

All notable changes to Renma are documented in this file.

This project follows the spirit of [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and uses semantic version tags.

## [Unreleased]

### Changed

- Refined deterministic security diagnostics for agent-facing context assets without adding package or CI workflow scanning.

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

[Unreleased]: https://github.com/KazuCocoa/renma/compare/v0.6.1...HEAD
[0.6.1]: https://github.com/KazuCocoa/renma/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/KazuCocoa/renma/compare/v0.5.1...v0.6.0
[0.5.1]: https://github.com/KazuCocoa/renma/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/KazuCocoa/renma/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/KazuCocoa/renma/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/KazuCocoa/renma/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/KazuCocoa/renma/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/KazuCocoa/renma/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/KazuCocoa/renma/releases/tag/v0.1.0
