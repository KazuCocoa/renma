## Summary

This pull request adds a narrowly scoped, isolated SkillSpector evidence
normalization and correlation experiment. It preserves a reviewed native
scanner report, projects each finding with explicit provenance, correlates only
exact repository-relative paths with captured Renma catalog assets, retains
unresolved and duplicate evidence, and records the observed results and design
questions.

This is not production scanner integration. No Renma command, library
entrypoint, or native diagnostic behavior changes. No readiness evaluation,
exit code, `ci-report`, or CI policy changes. No stable or public schema is
introduced. SkillSpector is not added to Renma's runtime or package
dependencies.

The purpose is to collect auditable evidence for a later design decision, not
to present the experimental projection as a completed architecture. The
observed SkillSpector 2.5.0 run produced six raw findings: four correlated by
exact path with governed assets and two remained unresolved because their file
was outside the fixture's Renma globs. Two duplicate pairs and all native IDs,
severity, confidence, remediation, and incomplete source ranges remain
visible.

## Validation

- `node --test experiments/skillspector/evidence-correlation/lib.test.mjs`
- `npm test`
- `npm run lint`
- `npm run format:check`
- `npm run verify:package`
- compare packaged file inventory and `renma --help` before and after the
  experiment changes
