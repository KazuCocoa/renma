---
id: lens.review
type: context_lens
version: "1"
release_version: "2026-09"
owner: review-team
purpose: Focus workflow review on explicitly recorded exceptions.
applies_to: [context.rules]
focus: [exceptions]
expected_outputs: [review-notes]
asset_bindings:
  - alias: rules
    target: context.rules
    version: "2.0"
---

# Review lens

Interpret [the rules](renma-asset:rules) by checking whether each exception has
an explicit justification. Return review notes with the supporting evidence.
