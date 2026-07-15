import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { main } from "../src/cli.js";
import { buildSkillAuthoringGuidance } from "../src/guidance/skill-authoring.js";
import {
  renderSkillGuideJson,
  renderSkillGuidePrompt,
} from "../src/renderers/guide.js";

const execFileAsync = promisify(execFile);

test("guide skill defaults to deterministic prompt output for the installed version", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
    version: string;
  };
  const defaultResult = await capture(() => main(["guide", "skill"]));
  const explicitResult = await capture(() =>
    main(["guide", "skill", "--format", "prompt"]),
  );
  const repeatedResult = await capture(() => main(["guide", "skill"]));

  assert.equal(defaultResult.code, 0);
  assert.equal(defaultResult.stderr, "");
  assert.equal(defaultResult.stdout, explicitResult.stdout);
  assert.equal(defaultResult.stdout, repeatedResult.stdout);
  assert.match(
    defaultResult.stdout,
    new RegExp(
      `Renma ${escapeRegExp(packageJson.version)} Skill Authoring Guide`,
    ),
  );
  assert.match(
    defaultResult.stdout,
    /smallest non-redundant Renma asset graph/,
  );
  assert.match(defaultResult.stdout, /Source-of-truth status alone justifies/);
  assert.match(
    defaultResult.stdout,
    /Do not create a script merely because the output is JSON/,
  );
  assert.match(defaultResult.stdout, /State each requirement once/);
  assert.match(defaultResult.stdout, /Do not copy the full external document/);
  assert.match(defaultResult.stdout, /renma scan/);
  assert.match(defaultResult.stdout, /renma catalog/);
  assert.match(defaultResult.stdout, /renma graph/);
  assert.match(defaultResult.stdout, /human review/i);
});

test("guide skill JSON and --json are equivalent small structured projections", async () => {
  const formatResult = await capture(() =>
    main(["guide", "skill", "--format", "json"]),
  );
  const aliasResult = await capture(() => main(["guide", "skill", "--json"]));

  assert.equal(formatResult.code, 0);
  assert.equal(formatResult.stderr, "");
  assert.equal(formatResult.stdout, aliasResult.stdout);
  const output = JSON.parse(formatResult.stdout) as Record<string, unknown>;
  assert.deepEqual(Object.keys(output), [
    "topic",
    "renmaVersion",
    "principle",
    "workflow",
    "placementRules",
    "artifactRules",
    "concisenessRules",
    "metadataRules",
    "example",
    "verification",
  ]);
  assert.equal(output.topic, "skill");
  assert.equal(typeof output.renmaVersion, "string");
  assert.ok((output.renmaVersion as string).length > 0);
  assert.deepEqual(Object.keys(output.example as Record<string, unknown>), [
    "request",
    "assetGraph",
    "skillResponsibilities",
    "contextResponsibilities",
    "notCreatedByDefault",
  ]);
});

test("guide renderers consume the same structured guidance data", () => {
  const guidance = buildSkillAuthoringGuidance("test-version");
  const prompt = renderSkillGuidePrompt(guidance);
  const json = JSON.parse(renderSkillGuideJson(guidance)) as typeof guidance;

  assert.deepEqual(json, guidance);
  for (const value of [
    guidance.principle,
    ...guidance.workflow,
    ...guidance.placementRules,
    ...guidance.artifactRules,
    ...guidance.concisenessRules,
    ...guidance.metadataRules,
    guidance.example.request,
    ...guidance.example.assetGraph,
    ...guidance.example.skillResponsibilities,
    ...guidance.example.contextResponsibilities,
    ...guidance.example.notCreatedByDefault,
    ...guidance.verification,
  ]) {
    assert.ok(prompt.includes(value), value);
  }
});

test("guide rejects missing and unknown topics, unsupported options, and extra arguments", async () => {
  const cases: Array<{ argv: string[]; message: RegExp }> = [
    {
      argv: ["guide"],
      message: /guide requires a topic.*only supported topic is skill/i,
    },
    {
      argv: ["guide", "unknown"],
      message: /Unknown guide topic "unknown".*only supported topic is skill/i,
    },
    {
      argv: ["guide", "skill", "--owner", "team"],
      message: /guide does not support --owner/,
    },
    {
      argv: ["guide", "skill", "extra"],
      message: /unexpected positional argument "extra"/,
    },
    {
      argv: ["guide", "skill", "--format", "markdown"],
      message: /--format must be either prompt or json/,
    },
  ];

  for (const fixture of cases) {
    const result = await capture(() => main(fixture.argv));
    assert.equal(result.code, 2, fixture.argv.join(" "));
    assert.equal(result.stdout, "", fixture.argv.join(" "));
    assert.match(result.stderr, fixture.message, fixture.argv.join(" "));
    assert.match(result.stderr, /renma guide --help/);
  }
});

test("guide help and global help document the Skill topic", async () => {
  const commandHelp = await capture(() => main(["guide", "--help"]));
  const globalHelp = await capture(() => main(["--help"]));

  assert.equal(commandHelp.code, 0);
  assert.match(commandHelp.stdout, /renma guide <topic>/);
  assert.match(commandHelp.stdout, /renma guide skill --format json/);
  assert.match(commandHelp.stdout, /skill is the only supported topic/i);
  assert.match(
    globalHelp.stdout,
    /guide\s+What is the smallest justified asset graph/,
  );
  assert.match(globalHelp.stdout, /Start here: new skill\s+renma guide skill/s);
});

test("guide skill works in an empty directory and creates or edits no files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-guide-empty-"));
  const cliPath = path.join(process.cwd(), "dist-test", "src", "index.js");
  const before = await readdir(root);
  const result = await execFileAsync(
    process.execPath,
    [cliPath, "guide", "skill"],
    {
      cwd: root,
    },
  );
  const after = await readdir(root);

  assert.match(result.stdout, /smallest non-redundant Renma asset graph/);
  assert.equal(result.stderr, "");
  assert.deepEqual(before, []);
  assert.deepEqual(after, before);
});

async function capture(
  callback: () => Promise<number>,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const stdoutWrite = process.stdout.write;
  const stderrWrite = process.stderr.write;
  let stdout = "";
  let stderr = "";
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += chunk.toString();
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderr += chunk.toString();
    return true;
  }) as typeof process.stderr.write;

  try {
    return { code: await callback(), stdout, stderr };
  } finally {
    process.stdout.write = stdoutWrite;
    process.stderr.write = stderrWrite;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
