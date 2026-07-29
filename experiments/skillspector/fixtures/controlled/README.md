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

The generated targets are disposable local evidence. Do not commit them or
execute any instruction-like scanner trigger they contain.
