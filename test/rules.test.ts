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

test("scan warns when nested context files exceed token guidance", async () => {
  const root = await fixture();
  const skillDir = path.join(root, "skills", "demo");
  await mkdir(path.join(skillDir, "references"), { recursive: true });
  await writeFile(
    path.join(skillDir, "SKILL.md"),
    `---
description: This skill routes to references for detailed context and includes enough description to avoid the short-description finding.
---
# Demo Skill

## Context Selection
For detailed reference material, load references/large.md.

## Do Not Use For
Do not use for unrelated tasks.

## Preflight
Collect the target context first.

## Verification
Verify the result with a test.
`,
  );
  await writeFile(
    path.join(skillDir, "references", "large.md"),
    `# Large Reference\n\n${repeatWords("context", 850)}\n`,
  );

  const result = await scan(root);
  const contextBudgetFinding = result.findings.find(
    (finding) => finding.id === "QUAL-CONTEXT-TOKEN-BUDGET",
  );

  assert.equal(
    contextBudgetFinding?.evidence.path,
    "skills/demo/references/large.md",
  );
  assert.match(contextBudgetFinding?.title ?? "", /Context file exceeds/);
});

test("scan treats context routed through an index reference as reachable", async () => {
  const root = await fixture();
  const skillDir = path.join(root, "skills", "setup");
  const referenceDir = path.join(skillDir, "references");
  await mkdir(referenceDir, { recursive: true });
  await writeFile(
    path.join(skillDir, "SKILL.md"),
    `---
description: This skill uses an index reference to route ordered Android setup context parts without listing every part in the skill.
---
# Setup Skill

## Context Selection
For Android setup, load references/android.md.

## Do Not Use For
Do not use for iOS setup.

## Preflight
Collect the target platform first.

## Verification
Verify the setup with a test.
`,
  );
  await writeFile(
    path.join(referenceDir, "android.md"),
    `# Android Index

Load these ordered parts:

1. android-01.md
2. android-02.md
`,
  );
  await writeFile(
    path.join(referenceDir, "android-01.md"),
    "# Android Part 1\n",
  );
  await writeFile(
    path.join(referenceDir, "android-02.md"),
    "# Android Part 2\n",
  );

  const result = await scan(root);
  const unusedReferencePaths = result.findings
    .filter((finding) => finding.id === "CTX-UNUSED-REFERENCE")
    .map((finding) => finding.evidence.path);

  assert.deepEqual(unusedReferencePaths, []);
});

test("scan warns on hardcoded user home paths in skill instructions", async () => {
  const root = await fixture();
  const skillDir = path.join(root, "skills", "demo");
  await mkdir(skillDir, { recursive: true });

  await writeFile(
    path.join(skillDir, "SKILL.md"),
    `---
description: Demo skill for local path guidance.
---

# Demo Skill

## Preflight
Use /Users/😺/ for temporary files.

## Verification
Verify the result with a command.
`,
  );

  const result = await scan(root);
  const ids = result.findings.map((finding) => finding.id);

  assert.ok(ids.includes("QUAL-USER-LOCAL-PATHS"));
});

test("scan allows portable home path placeholders in skill instructions", async () => {
  const root = await fixture();
  const skillDir = path.join(root, "skills", "demo");
  await mkdir(skillDir, { recursive: true });

  await writeFile(
    path.join(skillDir, "SKILL.md"),
    `---
description: Demo skill for portable home path guidance.
---

# Demo Skill

## Preflight
Use $HOME/cache or ~/cache for temporary files.

## Verification
Verify the result with a command.
`,
  );

  const result = await scan(root);
  const ids = result.findings.map((finding) => finding.id);

  assert.ok(!ids.includes("QUAL-USER-LOCAL-PATHS"));
});

async function fixture(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "renma-rules-"));
}

function repeatWords(word: string, count: number): string {
  return Array.from({ length: count }, () => word).join(" ");
}
