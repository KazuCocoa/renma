---
id: context.rules
version: "2.0"
owner: review-team
when_to_use: [Reviewing a workflow]
when_not_to_use: [Approving a deployment]
requires_context: [context.terms]
asset_bindings:
  - alias: terms
    target: context.terms
    version: "edition-3"
---

# Rules

Use [the terms](renma-asset:terms) to describe deviations. Record the reason
for each exception and the evidence supporting it.
