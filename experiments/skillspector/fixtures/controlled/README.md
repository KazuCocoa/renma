# Controlled SkillSpector Fixtures

These files are inert security-scanner test data for the opt-in SkillSpector
experiment. They are not runnable guidance, production Skills, examples, or
assets that Renma should discover. In particular, no committed fixture is
named `SKILL.md`.

Run the repository-local preparation helper to copy each template into an
ignored generated directory and give the copy the canonical filename expected
by SkillSpector:

```bash
node experiments/skillspector/prepare-controlled.mjs
```

The link false-positive case deliberately materializes `linked-target.template`,
which has only valid minimal `name` and `description` Agent Skills frontmatter
plus inert body text, as its benign `skills/Example/SKILL.md` destination. That
clean target makes the candidate a valid same-repository link without
committing a file named `SKILL.md`.

The generated targets are disposable local evidence. Do not commit them or
execute any instruction-like scanner trigger they contain.
