import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  formatSkillIndexJson,
  formatSkillIndexMarkdown,
  formatSkillIndexMermaid,
  projectSkillIndex,
  skillIndex,
  skillIndexHelp,
} from "../src/commands/skill-index.js";

test("skill-index discovers layered declared and observed routes", async () => {
  const root = await fixture();
  await writeSkill(
    root,
    "test-case-generation",
    `---
id: skill.test-case-generation
owner: qa-platform
status: stable
when_to_use:
  - Generating or reviewing test cases before a product workflow is selected
when_not_to_use:
  - Executing tests or debugging an observed failure
discovery_entrypoint: true
discovery_aliases:
  - generate test cases
routes_to:
  - skill.product.checkout.test-case-generation
---
# Test Case Generation

Continue with the [Checkout workflow](../products/checkout/test-case-generation/SKILL.md).
`,
  );
  await writeSkill(
    root,
    "products/checkout/test-case-generation",
    `---
id: skill.product.checkout.test-case-generation
owner: team-a
status: stable
tags:
  - category:test-case-generation
  - product:checkout
when_to_use:
  - Generating Checkout test cases
when_not_to_use:
  - Generating test cases for another product
---
# Checkout Test Case Generation

Continue with [requirements-based generation](./from-requirements/SKILL.md).
`,
  );
  await writeSkill(
    root,
    "products/checkout/test-case-generation/from-requirements",
    `---
id: skill.product.checkout.test-case-generation.from-requirements
owner: team-a
status: stable
tags:
  - product:checkout
---
# Checkout Test Cases From Requirements
`,
  );

  const report = await skillIndex(root);

  assert.equal(report.schemaVersion, "renma.skill-index.v1");
  assert.equal(report.skillCount, 3);
  assert.equal(report.routeCount, 2);
  assert.deepEqual(report.entrypointIds, ["skill.test-case-generation"]);
  assert.equal(report.reachableSkillCount, 3);

  const categoryRoute = report.routes.find(
    (route) => route.from === "skill.test-case-generation",
  );
  assert.equal(
    categoryRoute?.targetId,
    "skill.product.checkout.test-case-generation",
  );
  assert.deepEqual(
    categoryRoute?.evidence.map((evidence) => evidence.kind),
    ["metadata", "markdown_link"],
  );

  const checkout = report.skills.find(
    (skill) => skill.id === "skill.product.checkout.test-case-generation",
  );
  assert.deepEqual(checkout?.products, ["checkout"]);
  assert.equal(checkout?.reachable, true);
  assert.deepEqual(
    report.diagnostics.filter((diagnostic) =>
      diagnostic.code?.startsWith("DISCOVERY-"),
    ),
    [],
  );
});

test("skill-index reports exact route and entrypoint problems", async () => {
  const root = await fixture();
  await writeSkill(
    root,
    "root",
    `---
id: skill.root
owner: platform
status: stable
discovery_entrypoint: true
routes_to:
  - skill.missing
  - context.product.checkout.behavior
  - skill.legacy
---
# Root
`,
  );
  await writeContext(
    root,
    "products/checkout/behavior.md",
    `---
id: context.product.checkout.behavior
owner: checkout
status: stable
when_to_use:
  - Reviewing Checkout behavior
when_not_to_use:
  - Reviewing another product
---
# Checkout Behavior
`,
  );
  await writeSkill(
    root,
    "legacy",
    `---
id: skill.legacy
owner: legacy
status: deprecated
---
# Legacy
`,
  );
  await writeSkill(
    root,
    "cycle-a",
    `---
id: skill.cycle-a
owner: platform
status: stable
routes_to:
  - skill.cycle-b
---
# Cycle A
`,
  );
  await writeSkill(
    root,
    "cycle-b",
    `---
id: skill.cycle-b
owner: platform
status: stable
routes_to:
  - skill.cycle-a
---
# Cycle B
`,
  );
  await writeSkill(
    root,
    "alias-a",
    `---
id: skill.alias-a
owner: platform
status: stable
discovery_aliases:
  - shared alias
---
# Alias A
`,
  );
  await writeSkill(
    root,
    "alias-b",
    `---
id: skill.alias-b
owner: platform
status: stable
discovery_aliases:
  - Shared   Alias
---
# Alias B
`,
  );
  await writeSkill(
    root,
    "hidden",
    `---
id: skill.hidden
owner: platform
status: stable
discovery_entrypoint: false
---
# Hidden
`,
  );
  await writeSkill(
    root,
    "invalid-entrypoint",
    `---
id: skill.invalid-entrypoint
owner: platform
status: stable
discovery_entrypoint: sometimes
---
# Invalid Entrypoint
`,
  );

  const report = await skillIndex(root);
  const codes = new Set(
    report.diagnostics.map((diagnostic) => diagnostic.code),
  );

  assert.ok(codes.has("DISCOVERY-UNRESOLVED-ROUTE"));
  assert.ok(codes.has("DISCOVERY-ROUTE-TARGET-NOT-SKILL"));
  assert.ok(codes.has("DISCOVERY-DEPRECATED-SKILL-ROUTED"));
  assert.ok(codes.has("DISCOVERY-ROUTE-CYCLE"));
  assert.ok(codes.has("DISCOVERY-DUPLICATE-ALIAS"));
  assert.ok(codes.has("DISCOVERY-UNREACHABLE-SKILL"));
  assert.ok(codes.has("DISCOVERY-INVALID-ENTRYPOINT"));

  const unresolved = report.diagnostics.find(
    (diagnostic) => diagnostic.code === "DISCOVERY-UNRESOLVED-ROUTE",
  );
  assert.equal(unresolved?.evidence?.path, "skills/root/SKILL.md");
  assert.match(unresolved?.evidence?.snippet ?? "", /skill\.missing/);
});

test("skill-index projections and formats stay static and reviewable", async () => {
  const root = await fixture();
  await writeSkill(
    root,
    "setup",
    `---
id: skill.setup
owner: platform
status: stable
discovery_entrypoint: true
discovery_aliases:
  - setup tools
routes_to:
  - skill.setup.appium
---
# Setup
`,
  );
  await writeSkill(
    root,
    "setup/appium",
    `---
id: skill.setup.appium
owner: mobile
status: stable
tags:
  - product:mobile-automation
---
# Appium Setup
`,
  );

  const report = await skillIndex(root);
  const entrypoints = projectSkillIndex(report, "entrypoints");
  const focused = projectSkillIndex(report, "full", "setup tools");
  const markdown = formatSkillIndexMarkdown(entrypoints);
  const json = formatSkillIndexJson(focused);
  const mermaid = formatSkillIndexMermaid(focused);

  assert.match(markdown, /^# Renma Skill Index/);
  assert.match(markdown, /Static repository discovery evidence/);
  assert.match(markdown, /### Setup/);
  assert.match(markdown, /skill\.setup\.appium/);
  assert.doesNotMatch(markdown, /### Appium Setup/);

  assert.match(json, /"schemaVersion": "renma\.skill-index\.v1"/);
  assert.match(json, /"focus": "setup tools"/);
  assert.match(mermaid, /^graph TD/);
  assert.match(mermaid, /skill\.setup/);
  assert.match(mermaid, /skill\.setup\.appium/);

  assert.match(skillIndexHelp("0.15.2"), /experimental skill-index/i);
  assert.match(skillIndexHelp("0.15.2"), /does not select/i);
});

async function fixture(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "renma-skill-index-"));
}

async function writeSkill(
  root: string,
  relativeDirectory: string,
  content: string,
): Promise<void> {
  const directory = path.join(root, "skills", ...relativeDirectory.split("/"));
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "SKILL.md"), content);
}

async function writeContext(
  root: string,
  relativePath: string,
  content: string,
): Promise<void> {
  const target = path.join(root, "contexts", ...relativePath.split("/"));
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content);
}
