import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { formatJson } from "../src/report.js";
import { scan } from "../src/scanner.js";

test("removed Renma routing metadata does not invalidate Agent Skills", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "renma-routing-metadata-boundary-"),
  );
  const skillDirectory = path.join(root, "skills", "demo");
  await mkdir(skillDirectory, { recursive: true });
  await writeFile(
    path.join(skillDirectory, "SKILL.md"),
    `---
name: demo
description: Review demo inputs. Use when deterministic demo review is needed.
metadata:
  renma.when-to-use: '["legacy routing"]'
  renma.when-not-to-use: '["runtime execution"]'
---
# Demo
`,
  );

  const result = await scan(root, { failOn: "critical" });
  const validation = result.agentSkills.results.find(
    (item) => item.path === "skills/demo/SKILL.md",
  );

  assert.ok(validation);
  assert.equal(validation.valid, true);
  assert.equal(validation.errorCount, 0);
  assert.deepEqual(
    validation.issues
      .filter((issue) => issue.code === "RN-SKILL-UNSUPPORTED-ROUTING-METADATA")
      .map((issue) => [issue.severity, issue.category, issue.field]),
    [
      ["warning", "renma-authoring", "metadata.renma.when-to-use"],
      ["warning", "renma-authoring", "metadata.renma.when-not-to-use"],
    ],
  );

  const serialized = JSON.parse(formatJson(result)) as {
    agentSkills: { results: Array<{ issues: Array<{ code: string }> }> };
  };
  assert.deepEqual(
    serialized.agentSkills.results
      .flatMap((item) => item.issues)
      .map((issue) => issue.code)
      .filter((code) => code.includes("UNSUPPORTED-ROUTING-METADATA")),
    [
      "RN-SKILL-UNSUPPORTED-ROUTING-METADATA",
      "RN-SKILL-UNSUPPORTED-ROUTING-METADATA",
    ],
  );
});
