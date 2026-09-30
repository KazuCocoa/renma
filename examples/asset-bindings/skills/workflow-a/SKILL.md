---
name: workflow-a
description: Use this Skill to review a workflow using its pinned supporting workflow and review lens.
metadata:
  renma.id: skill.a
  renma.version: "1.0.1"
  renma.owner: review-team
  renma.requires-skill: '["skill.b"]'
  renma.optional-lens: '["lens.review"]'
  renma.asset-bindings: '[{"alias":"b","target":"skill.b","version":"1.0.0","ref":"v1.0.0","resolved":{"commit":"7e91d1654daaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}},{"alias":"review","target":"lens.review","version":"2026-09"}]'
---

# Workflow A

Follow [workflow B](renma-asset:b). When the review lens is included, interpret
its Context using [the review lens](renma-asset:review).

The builder must include the optional lens or reject the dangling reference.
