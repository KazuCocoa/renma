# Skill Discovery

Status: experimental

Skill Discovery helps a large Context Repository expose a bounded path through
many `SKILL.md` files without turning Renma into a runtime skill selector.

The initial interface is:

```bash
renma skill-index .
```

It builds a deterministic, static projection from repository evidence. The
report is useful to agents that need a first place to look and to humans who
need to review whether layered skill routing remains understandable.

Renma still does not accept task text, rank skills, assemble prompts, inject
context, or execute an agent.

## The Core Idea

A repository may contain broad skills, narrow skills, and several routing
layers:

```text
generated skill index
  -> broad entrypoint SKILL.md
    -> product, platform, or team SKILL.md
      -> concrete workflow SKILL.md
        -> context lenses and context assets
```

The generated index owns first-hop visibility. Source `SKILL.md` files remain
the routing and workflow contracts. Context lenses remain interpretation
layers. Context assets remain the durable source of truth.

## What Is An Entrypoint?

An entrypoint is a role played by a normal `SKILL.md`. It is not a new artifact
kind and does not require a special directory.

An entrypoint receives a request that is still too broad for one concrete
workflow. It explains the decision boundary it owns, then directs the reader
toward a smaller and more specific skill.

For example:

```text
"Generate test cases"
  -> test-case-generation/SKILL.md
    -> Checkout test-case-generation/SKILL.md
      -> from-requirements/SKILL.md
```

The first skill owns the broad testing intent. The Checkout skill owns
product-specific routing and references. The final skill owns the concrete
workflow.

An entrypoint may also be a complete workflow. A repository with only one
unambiguous skill does not need to create a separate router solely for Renma.

```text
Entrypoint is a role, not a type.
```

## Why Entrypoints Matter

### They keep routing responsibility local

A top-level index should not know every product, platform, and workflow rule in
the repository. A category or product entrypoint can be maintained by the
people who understand that boundary.

```text
Top-level index
  owns the first hop

Category entrypoint
  owns category routing policy

Product or platform entrypoint
  owns local routing and references

Concrete skill
  owns the workflow
```

### They keep individual skills small

Without an entrypoint, every concrete skill may need to repeat the same
selection rules. Layered routing lets concrete skills focus on required inputs,
steps, constraints, completion criteria, and verification.

### They provide stable repository interfaces

Teams and maintainers can change while a product remains. A stable product or
category entrypoint can continue to route to current workflows without moving
or duplicating durable product context.

```text
Product identity and product context remain stable.
Current owner and team routing may change.
```

### They avoid a central handwritten mega-index

A generated index can summarize current roots and direct routes. Each source
entrypoint keeps the detailed routing policy close to its owner. Adding one
team-specific or product-specific skill does not require copying its workflow
into a global file.

## When To Add An Entrypoint

Consider adding or strengthening an entrypoint when:

- One broad intent matches several skills.
- A reader must identify a product, platform, input type, or workflow stage
  before continuing.
- Several owners maintain different parts of one capability.
- Direct leaf selection is regularly ambiguous.
- The internal skill structure may change while a stable starting point should
  remain.
- The first-hop skill surface has become too large to review comfortably.

A separate entrypoint is usually unnecessary when:

- One skill is already the only clear match.
- The proposed entrypoint would only repeat a directory listing.
- The proposed file would copy detailed workflow or context from its children.
- The additional routing layer would not remove a real decision from a lower
  skill.

## A Good Entrypoint

A useful entrypoint describes a real decision boundary:

```md
# Test Case Generation

Use this skill when the request is about creating or reviewing test cases but
the product-specific workflow is not yet selected.

Do not use this skill for executing tests or debugging an observed test failure.

## Route By Product

- Checkout: continue with `skill.product.checkout.test-case-generation`.
- Search: continue with `skill.product.search.test-case-generation`.

If the product is unclear, inspect the affected repository path or ask for the
product area. Do not generate final cases from this entrypoint alone.
```

A weak entrypoint is only a large list:

```md
# Test Case Generation

- Team A skill
- Team B skill
- Team C skill
- Team D skill
```

The list does not explain how to choose, what responsibility belongs at this
layer, or when no child is appropriate.

## Declaring Routes

A skill can declare exact routes in compact frontmatter:

```yaml
---
id: skill.test-case-generation
owner: qa-platform
status: stable
discovery_entrypoint: true
discovery_aliases:
  - generate test cases
  - test case design
routes_to:
  - skill.product.checkout.test-case-generation
  - skills/products/search/test-case-generation/SKILL.md
---
```

`routes_to` accepts an exact discovered skill ID or a repository-relative path.
It is static repository evidence. It does not mean Renma selected or loaded the
target for a live task.

`discovery_entrypoint` is optional:

- `true` publishes the active skill as an explicit first-hop entrypoint.
- `false` prevents root inference for that skill.
- When omitted, an active skill with no incoming resolved active route is an
  inferred entrypoint.

`discovery_aliases` is optional. Aliases improve exact inspection and review;
they are not fuzzy search terms. Renma reports an alias claimed by more than one
active skill.

Existing metadata continues to define the useful routing boundary:

- `when_to_use`
- `when_not_to_use`
- `owner`
- `status`
- `tags`
- `requires_context`
- `optional_context`
- `requires_lens`
- `optional_lens`

A namespaced tag such as `product:checkout` provides a stable product facet
without requiring a product directory or a new artifact type.

## Existing Markdown Links

Adoption does not require adding metadata to every existing skill immediately.
An exact local Markdown link from one discovered skill to another is reported as
an observed route:

```md
Continue with the [Checkout workflow](../products/checkout/SKILL.md).
```

Declared routes and observed links are kept as separate evidence forms. When
both point to the same target, the report merges them into one route while
preserving both pieces of evidence.

A normal link to a context, external page, section anchor, or non-skill file is
not treated as an observed skill route. `routes_to` declarations that point to a
non-skill asset are reported because they should use the appropriate context or
lens relationship instead.

## Using `skill-index`

The default output is a compact first-hop Markdown view:

```bash
renma skill-index .
renma skill-index . --format markdown
```

Use JSON for downstream tools:

```bash
renma skill-index . --view full --format json
```

Use the route view to inspect the whole skill-to-skill surface:

```bash
renma skill-index . --view routes --format markdown
```

Use Mermaid for a review visualization:

```bash
renma skill-index . --view routes --format mermaid
```

Focus on one exact skill ID, source path, or alias:

```bash
renma skill-index . --focus skill.test-case-generation
renma skill-index . --focus skills/test-case-generation/SKILL.md
renma skill-index . --focus "generate test cases" --format mermaid
```

The command prints to stdout. It does not create `.renma/`, rewrite metadata,
move skills, or update a checked-in index automatically. A repository may
explicitly redirect the output when a checked-in or CI artifact is useful:

```bash
renma skill-index . > SKILL_INDEX.md
```

## Reading The Result

The report separates several concepts:

- **Entrypoint**: an explicit or inferred active root.
- **Route**: an exact declared or observed skill-to-skill relationship.
- **Reachable skill**: an active skill reachable from at least one entrypoint.
- **Product facet**: an exact `product:<id>` tag on a skill.
- **Diagnostic**: deterministic evidence that the routing surface needs review.

The first-hop report is not authoritative workflow guidance. Use it in this
order:

1. Match the broad task to an entrypoint's usage boundaries.
2. Open the source `SKILL.md`.
3. Follow a route only when the source skill's conditions apply.
4. Read the selected skill and its required lenses and contexts.
5. Treat source skills, lenses, and contexts as authoritative over generated
   index prose.
6. Do not guess when no route is clear.

## Diagnostics

The experimental report can surface:

- `DISCOVERY-UNRESOLVED-ROUTE`
- `DISCOVERY-ROUTE-TARGET-NOT-SKILL`
- `DISCOVERY-DEPRECATED-SKILL-ROUTED`
- `DISCOVERY-INVALID-ENTRYPOINT`
- `DISCOVERY-ROUTE-CYCLE`
- `DISCOVERY-DUPLICATE-ALIAS`
- `DISCOVERY-UNREACHABLE-SKILL`

These findings describe repository routing health. They do not score whether a
particular live task chose the correct skill.

## Example: Layered Setup

```text
setup/SKILL.md
  -> appium/setup/SKILL.md
    -> appium/setup/android-uiautomator2/SKILL.md
    -> appium/setup/ios-xcuitest/SKILL.md
```

`setup/SKILL.md` should decide which setup domain applies. The Appium setup skill
should decide platform, driver, and device type. The Android and iOS leaves
should contain concrete preflight, workflow, and verification guidance.

The entrypoints should not copy UiAutomator2 or XCUITest procedures from their
leaf skills.

## Example: Test Case Generation Across Changing Teams

```text
test-case-generation/SKILL.md
  -> product/checkout/test-case-generation/SKILL.md
    -> current team workflow
      -> from-requirements/SKILL.md
```

The product skill can reference durable assets such as:

```text
context.product.checkout.behavior
context.product.checkout.regression-risk
lens.product.checkout.test-case-generation
```

A current team may add a team-specific lens or process, but a future ownership
change should not require replacing stable Checkout behavior. Renma can show the
current owner and the product facet separately.

The physical repository may instead be team-first or use another layout. Route
relationships, stable IDs, and exact references matter more than a required
directory hierarchy.

## Incremental Adoption

For a repository that already has many skills:

1. Run `renma skill-index .` without moving files.
2. Review inferred entrypoints and observed links.
3. Identify one crowded or ambiguous capability.
4. Improve that capability's existing broad `SKILL.md` as an entrypoint.
5. Add `routes_to` only where an explicit contract improves reviewability.
6. Add `discovery_entrypoint: true` only for intentional first-hop roots.
7. Keep durable knowledge in reusable contexts and interpretation in lenses.
8. Rerun the index and inspect diagnostics.
9. Expand to another crowded area after the routing boundary proves useful.

No repository-wide migration is required.

## Common Mistakes

Avoid:

- Marking every skill as an explicit entrypoint.
- Creating a required category/product/team directory hierarchy.
- Copying child workflow instructions into a parent entrypoint.
- Treating `routes_to` as context loading or prompt assembly.
- Using team ownership as the only evidence of product identity.
- Hiding a skill with `discovery_entrypoint: false` without making it reachable
  from another entrypoint.
- Resolving ambiguity by creating one central file that owns every team's
  routing policy.
- Assuming an observed link proves that the route is semantically correct.

## Product Boundary

Skill Discovery remains inside Renma's repository-governance boundary:

```text
Repository authors define routing contracts.
Renma records, validates, summarizes, and visualizes them.
Agents decide how to use repository assets at task time.
Humans review changes.
```

The governing rule remains:

```text
LLM proposes. Renma verifies. Human approves.
```
