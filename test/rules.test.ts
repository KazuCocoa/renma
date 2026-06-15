import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { scan } from "../src/scanner.js";

test("scan preserves context orchestration and profile findings", async () => {
  const root = await fixture();
  const skillDir = path.join(root, "skills", "demo");
  await mkdir(path.join(skillDir, "profiles"), { recursive: true });
  await mkdir(path.join(skillDir, "references"), { recursive: true });
  await mkdir(path.join(skillDir, "examples"), { recursive: true });
  await writeFile(
    path.join(skillDir, "SKILL.md"),
    `---
description: This skill has a long enough description for deterministic scanning but intentionally omits context routing details so the context checks remain visible.
---
# Demo Skill

## Preflight
Collect the task context before acting.

## Verification
Verify the result with a test command.

## Do Not Use For
Do not use for production credential changes.
`,
  );
  await writeFile(
    path.join(skillDir, "profiles", "mobile.md"),
    "# Mobile Profile\nUse this profile for mobile test work.\n",
  );
  await writeFile(
    path.join(skillDir, "references", "secret.md"),
    "api_key = abcdefghijk12345\n",
  );
  await writeFile(
    path.join(skillDir, "examples", "happy-path.md"),
    "# Happy Path\nUse this example for simple tasks.\n",
  );

  const result = await scan(root);
  const ids = result.findings.map((finding) => finding.id);

  assert.ok(ids.includes("CTX-MISSING-ROUTING-MAP"));
  assert.ok(ids.includes("CTX-UNUSED-PROFILE"));
  assert.ok(ids.includes("CTX-UNUSED-REFERENCE"));
  assert.ok(ids.includes("CTX-UNUSED-EXAMPLE"));
  assert.ok(ids.includes("PROF-MISSING-BASE"));
  assert.ok(ids.includes("SEC-LITERAL-SECRET"));
});

test("scan preserves security finding evidence paths", async () => {
  const root = await fixture();
  await mkdir(path.join(root, "skills", "demo"), { recursive: true });
  await writeFile(
    path.join(root, "skills", "demo", "SKILL.md"),
    "# Demo\n\npassword = abcdefghijk12345\n",
  );

  const result = await scan(root);
  const secretFinding = result.findings.find(
    (finding) => finding.id === "SEC-LITERAL-SECRET",
  );

  assert.equal(secretFinding?.evidence.path, "skills/demo/SKILL.md");
  assert.equal(secretFinding?.evidence.startLine, 3);
  assert.match(secretFinding?.evidence.snippet ?? "", /password/);
});

async function fixture(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "renma-rules-"));
}
