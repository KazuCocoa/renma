---
name: workflow-b
description: Use this Skill to review a workflow against the declared rules.
metadata:
  renma.id: skill.b
  renma.version: "1.0.0"
  renma.owner: review-team
  renma.requires-context: '["context.rules"]'
  renma.asset-bindings: '[{"alias":"rules","target":"context.rules","version":"2.0"}]'
---

# Workflow B

Check [the rules](renma-asset:rules) and explain any deviations.
