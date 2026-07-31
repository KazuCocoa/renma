import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";

import { main } from "../src/cli.js";
import { graph } from "../src/commands/graph.js";
import { RepositoryFixture } from "./repository-fixture.js";

test("executable graph keeps invocation, containment, shared use, and evidence distinct", async (t) => {
  const fixture = await RepositoryFixture.create({
    prefix: "renma-executable-graph-",
    testContext: t,
  });
  await fixture.skill("release-prep", {
    id: "skill.release-prep",
    body: [
      "# Release prep",
      "",
      "```bash",
      "node scripts/prepare-release.ts",
      "node scripts/prepare-release.ts",
      "bash tools/check-changelog.sh",
      "```",
    ].join("\n"),
  });
  await fixture.skill("publish", {
    id: "skill.publish",
    body: [
      "# Publish",
      "",
      "```bash",
      "bash tools/check-changelog.sh",
      "```",
    ].join("\n"),
  });
  await fixture.write(
    "skills/release-prep/scripts/prepare-release.ts",
    'import "../../../tools/check-changelog.sh";\n',
  );
  await fixture.write("tools/check-changelog.sh", "#!/bin/sh\nexit 0\n");

  const first = await captureGraph([
    "graph",
    fixture.root,
    "--view",
    "executable",
    "--format",
    "json",
  ]);
  const second = await captureGraph([
    "graph",
    fixture.root,
    "--view",
    "executable",
    "--format",
    "json",
  ]);
  assert.equal(first.code, 0);
  assert.equal(first.stderr, "");
  assert.equal(first.stdout, second.stdout);

  const report = JSON.parse(first.stdout) as {
    view: string;
    nodes: Array<{
      id: string;
      executableRole: string;
      executableScope?: string;
      invokedBySkillCount?: number;
    }>;
    edges: Array<{
      from: string;
      kind: string;
      to: string;
      evidenceCount?: number;
    }>;
    executable: {
      invocationEvidence: Array<{
        sourcePath: string;
        normalizedTarget?: string;
      }>;
      dependencyEvidence: Array<{
        sourcePath: string;
        normalizedTarget?: string;
      }>;
    };
    diagnostics?: unknown[];
  };
  assert.equal(report.view, "executable");
  assert.equal(report.diagnostics, undefined);
  assert.deepEqual(
    report.edges.map((edge) => [
      edge.from,
      edge.kind,
      edge.to,
      edge.evidenceCount,
    ]),
    [
      ["skill.publish", "invokes", "tools/check-changelog.sh", 1],
      [
        "skill.release-prep",
        "contains",
        "skills/release-prep/scripts/prepare-release.ts",
        undefined,
      ],
      [
        "skill.release-prep",
        "invokes",
        "skills/release-prep/scripts/prepare-release.ts",
        2,
      ],
      ["skill.release-prep", "invokes", "tools/check-changelog.sh", 1],
      [
        "skills/release-prep/scripts/prepare-release.ts",
        "invokes",
        "tools/check-changelog.sh",
        1,
      ],
    ],
  );
  assert.equal(report.executable.invocationEvidence.length, 4);
  assert.equal(report.executable.dependencyEvidence.length, 1);

  const local = report.nodes.find(
    (node) => node.id === "skills/release-prep/scripts/prepare-release.ts",
  );
  assert.equal(local?.executableRole, "repository-script");
  assert.equal(local?.executableScope, "skill-local");
  const shared = report.nodes.find(
    (node) => node.id === "tools/check-changelog.sh",
  );
  assert.equal(shared?.executableRole, "repository-script");
  assert.equal(shared?.executableScope, "repository-tool");
  assert.equal(shared?.invokedBySkillCount, 2);
  assert.equal(
    report.edges.some(
      (edge) =>
        edge.kind === "contains" && edge.to === "tools/check-changelog.sh",
    ),
    false,
  );
});

test("executable graph focuses a script as a stable reverse used-by view", async (t) => {
  const fixture = await sharedScriptFixture(t);
  const result = await captureGraph([
    "graph",
    fixture.root,
    "--view",
    "executable",
    "--focus",
    "tools/check.sh",
    "--format",
    "markdown",
  ]);

  assert.equal(result.code, 0);
  assert.equal(result.stderr, "");
  assert.match(
    result.stdout,
    /### tools\/check\.sh \(repository script; repository-tool\)/,
  );
  assert.match(result.stdout, /used by → skill\.alpha \(Skill\)/);
  assert.match(result.stdout, /used by → skill\.beta \(Skill\)/);
  assert.doesNotMatch(result.stdout, /belongs to →/);
  assert.doesNotMatch(result.stdout, /## Diagnostics/);
});

test("executable graph focuses a Skill and distinguishes contains from invokes", async (t) => {
  const fixture = await RepositoryFixture.create({
    prefix: "renma-executable-skill-focus-",
    testContext: t,
  });
  await fixture.skill("alpha", {
    id: "skill.alpha",
    body: [
      "# Alpha",
      "",
      "```bash",
      "node scripts/local.ts",
      "node tools/shared.ts",
      "```",
    ].join("\n"),
  });
  await fixture.write("skills/alpha/scripts/local.ts", "export {};\n");
  await fixture.write("tools/shared.ts", "export {};\n");

  const result = await captureGraph([
    "graph",
    fixture.root,
    "--view",
    "executable",
    "--focus",
    "skill.alpha",
    "--format",
    "markdown",
  ]);

  assert.equal(result.code, 0);
  assert.match(result.stdout, /contains → skills\/alpha\/scripts\/local\.ts/);
  assert.match(result.stdout, /invokes → skills\/alpha\/scripts\/local\.ts/);
  assert.match(result.stdout, /invokes → tools\/shared\.ts/);
  assert.doesNotMatch(result.stdout, /contains → tools\/shared\.ts/);

  const reverse = await captureGraph([
    "graph",
    fixture.root,
    "--view",
    "executable",
    "--focus",
    "skills/alpha/scripts/local.ts",
    "--format",
    "markdown",
  ]);
  assert.equal(reverse.code, 0);
  assert.match(reverse.stdout, /belongs to → skill\.alpha \(Skill\)/);
  assert.match(reverse.stdout, /used by → skill\.alpha \(Skill\)/);
});

test("external executable targets stay distinct and never gain containment", async (t) => {
  const fixture = await RepositoryFixture.create({
    prefix: "renma-executable-external-",
    testContext: t,
  });
  await fixture.skill("external", {
    id: "skill.external",
    body: [
      "# External",
      "",
      "```bash",
      "node /opt/vendor/scripts/run.js",
      "```",
    ].join("\n"),
  });

  const result = await captureGraph([
    "graph",
    fixture.root,
    "--view",
    "executable",
    "--focus",
    "skill.external",
    "--format",
    "json",
  ]);
  assert.equal(result.code, 0);
  const report = JSON.parse(result.stdout) as {
    nodes: Array<{ id: string; executableRole?: string }>;
    edges: Array<{ from: string; kind: string; to: string }>;
    executable: {
      invocationEvidence: Array<{
        rawTarget: string;
        normalizedTarget?: string;
        resolution: string;
      }>;
    };
  };
  assert.deepEqual(
    report.nodes.map((node) => [node.id, node.executableRole]),
    [
      ["external:/opt/vendor/scripts/run.js", "external-executable"],
      ["skill.external", "skill"],
    ],
  );
  assert.deepEqual(
    report.edges.map((edge) => ({
      from: edge.from,
      kind: edge.kind,
      to: edge.to,
    })),
    [
      {
        from: "skill.external",
        kind: "invokes",
        to: "/opt/vendor/scripts/run.js",
      },
    ],
  );
  assert.equal(
    report.edges.some((edge) => edge.kind === "contains"),
    false,
  );
  assert.deepEqual(
    report.executable.invocationEvidence.map((invocation) => ({
      target: invocation.rawTarget,
      normalized: invocation.normalizedTarget,
      resolution: invocation.resolution,
    })),
    [
      {
        target: "/opt/vendor/scripts/run.js",
        normalized: undefined,
        resolution: "unsafe",
      },
    ],
  );

  const mermaid = await captureGraph([
    "graph",
    fixture.root,
    "--view",
    "executable",
    "--focus",
    "/opt/vendor/scripts/run.js",
    "--format",
    "mermaid",
  ]);
  assert.equal(mermaid.code, 0);
  assert.match(mermaid.stdout, /external executable: external:/);
  assert.match(mermaid.stdout, /classDef externalExecutable/);
  assert.doesNotMatch(mermaid.stdout, /\|contains\|/);
  assert.doesNotMatch(mermaid.stdout, /%% Diagnostics:/);
});

test("executable graph human formats show retained diagnostics and preserve error exits", async (t) => {
  const fixture = await RepositoryFixture.create({
    prefix: "renma-executable-diagnostics-",
    testContext: t,
  });
  await fixture.skill("diagnostics", {
    id: "skill.diagnostics",
    body: ["# Diagnostics", "", "```bash", "bash tools/check.sh", "```"].join(
      "\n",
    ),
  });
  await fixture.write("tools/check.sh", "#!/bin/sh\nexit 0\n");
  await fixture.contextLens("lenses/incomplete.md", {
    id: "lens.incomplete",
  });

  const markdown = await captureGraph([
    "graph",
    fixture.root,
    "--view",
    "executable",
    "--format",
    "markdown",
  ]);
  assert.equal(markdown.code, 1);
  assert.equal(markdown.stderr, "");
  assert.match(markdown.stdout, /## Diagnostics/);
  assert.match(
    markdown.stdout,
    /- error: lenses\/incomplete\.md: Context lens definition is missing required field "owner"\./,
  );

  const mermaid = await captureGraph([
    "graph",
    fixture.root,
    "--view",
    "executable",
    "--format",
    "mermaid",
  ]);
  assert.equal(mermaid.code, 1);
  assert.equal(mermaid.stderr, "");
  assert.match(mermaid.stdout, /%% Diagnostics:/);
  assert.match(
    mermaid.stdout,
    /%% error: lenses\/incomplete\.md: Context lens definition is missing required field "owner"\./,
  );

  const json = await captureGraph([
    "graph",
    fixture.root,
    "--view",
    "executable",
    "--format",
    "json",
  ]);
  assert.equal(json.code, 1);
  assert.equal(json.stderr, "");
  const report = JSON.parse(json.stdout) as {
    diagnostics?: Array<{ severity: string; path?: string; message: string }>;
  };
  assert.ok(
    report.diagnostics?.some(
      (diagnostic) =>
        diagnostic.severity === "error" &&
        diagnostic.path === "lenses/incomplete.md" &&
        diagnostic.message ===
          'Context lens definition is missing required field "owner".',
    ),
  );
});

test("executable empty state is actionable and ordinary graph output is unchanged", async (t) => {
  const fixture = await RepositoryFixture.create({
    prefix: "renma-executable-empty-",
    testContext: t,
  });
  await fixture.skill("empty", { id: "skill.empty" });

  const before = await graph(fixture.root);
  const executable = await captureGraph([
    "graph",
    fixture.root,
    "--view",
    "executable",
    "--focus",
    "skill.empty",
    "--format",
    "markdown",
  ]);
  const after = await graph(fixture.root);

  assert.deepEqual(after, before);
  assert.equal(before.view, "full");
  assert.equal(
    before.edges.some(
      (edge) => edge.kind === "invokes" || edge.kind === "contains",
    ),
    false,
  );
  assert.match(
    executable.stdout,
    /No canonical executable relationships were found/,
  );
  assert.match(
    executable.stdout,
    /renma scan \. --format json.*executableSurfaceInventory/,
  );
});

test("graph help makes Skill-to-script and script-to-Skill inspection discoverable", async () => {
  const help = await captureGraph(["graph", "--help"]);
  assert.equal(help.code, 0);
  assert.match(help.stdout, /--view executable/);
  assert.match(help.stdout, /which scripts a Skill invokes/i);
  assert.match(help.stdout, /which Skills use a script/i);
});

async function sharedScriptFixture(t: TestContext): Promise<RepositoryFixture> {
  const fixture = await RepositoryFixture.create({
    prefix: "renma-executable-reverse-",
    testContext: t,
  });
  for (const name of ["alpha", "beta"]) {
    await fixture.skill(name, {
      id: `skill.${name}`,
      body: [`# ${name}`, "", "```bash", "bash tools/check.sh", "```"].join(
        "\n",
      ),
    });
  }
  await fixture.write("tools/check.sh", "#!/bin/sh\nexit 0\n");
  return fixture;
}

async function captureGraph(argv: string[]): Promise<{
  code: number;
  stdout: string;
  stderr: string;
}> {
  let stdout = "";
  let stderr = "";
  const stdoutWrite = process.stdout.write;
  const stderrWrite = process.stderr.write;
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += chunk.toString();
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderr += chunk.toString();
    return true;
  }) as typeof process.stderr.write;
  try {
    return { code: await main(argv), stdout, stderr };
  } finally {
    process.stdout.write = stdoutWrite;
    process.stderr.write = stderrWrite;
  }
}
