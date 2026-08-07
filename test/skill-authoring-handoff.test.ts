import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { Ajv2020, type AnySchemaObject } from "ajv/dist/2020.js";

import { main } from "../src/cli.js";
import { classifyCliError, CLI_EXIT, CliUserError } from "../src/cli-errors.js";
import { buildSkillAuthoringGuidance } from "../src/guidance/skill-authoring.js";
import {
  classifySkillAuthoringHandoffReadError,
  SKILL_AUTHORING_HANDOFF_SCHEMA_VERSION,
  type SkillAuthoringHandoff,
} from "../src/skill-authoring-handoff.js";

const SCHEMA_PATH = "docs/schemas/skill-authoring-handoff-v1.schema.json";

test("scaffold skill JSON preserves a gate-ready structured handoff", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-handoff-json-"));
  const handoffPath = path.join(root, "handoff.json");
  const target = path.join(root, "skills", "example", "SKILL.md");
  await writeHandoff(handoffPath, gateReadyHandoff());

  const result = await capture(() =>
    main([
      "scaffold",
      "skill",
      target,
      "--handoff",
      handoffPath,
      "--format",
      "json",
    ]),
  );

  assert.equal(result.code, 0);
  assert.equal(result.stderr, "");
  const bundle = JSON.parse(result.stdout) as {
    id: string;
    title: string;
    owner: string;
    tags: string[];
    resources: string[];
    content: string;
    prompt: string;
    handoff: SkillAuthoringHandoff;
  };
  assert.equal(bundle.id, "skill.example");
  assert.equal(bundle.title, "Evidence Review");
  assert.equal(bundle.owner, "qa-platform");
  assert.deepEqual(bundle.tags, ["testing", "review"]);
  assert.deepEqual(bundle.resources, ["references"]);
  assert.deepEqual(bundle.handoff.assetGraph.skill.requiresContext, [
    "context.testing.boundaries",
  ]);
  assert.deepEqual(bundle.handoff.assetGraph.skill.optionalContext, [
    "context.testing.examples",
  ]);
  assert.deepEqual(bundle.handoff.currentUnderstanding.proposed, [
    "Report findings before proposing edits.",
  ]);
  assert.deepEqual(bundle.handoff.currentUnderstanding.unresolved, [
    "Final report wording remains open.",
  ]);
  assert.deepEqual(bundle.handoff.progression.deferred, [
    "Choose final report wording during prose authoring.",
  ]);
  assert.match(
    bundle.content,
    /renma\.requires-context: '\["context\.testing\.boundaries"\]'/,
  );
  assert.match(
    bundle.content,
    /renma\.optional-context: '\["context\.testing\.examples"\]'/,
  );
  assert.match(
    bundle.content,
    /renma\.requires-lens: '\["lens\.testing\.risk"\]'/,
  );
  assert.match(bundle.content, /renma\.optional-lens: '\[\]'/);
  assert.doesNotMatch(bundle.content, /Report findings before proposing edits/);
  assert.doesNotMatch(bundle.content, /Final report wording remains open/);
  assert.doesNotMatch(bundle.content, /Reversible defaults|Deferred:/);
  assert.match(bundle.prompt, /Authoring handoff/);
  assert.match(bundle.prompt, /Blocking: 0/);
  assert.match(bundle.prompt, /Do not promote Proposed or Unresolved facts/);
  await assert.rejects(readFile(target, "utf8"));
});

test("scaffold skill file mode applies handoff metadata and creates only declared local resources", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-handoff-file-"));
  const handoffPath = path.join(root, "handoff.json");
  const skillDirectory = path.join(root, "skills", "example");
  const target = path.join(skillDirectory, "SKILL.md");
  await writeHandoff(handoffPath, gateReadyHandoff());

  const result = await capture(() =>
    main(["scaffold", "skill", target, "--handoff", handoffPath]),
  );

  assert.equal(result.code, 0);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /Created .*SKILL\.md/);
  const content = await readFile(target, "utf8");
  assert.match(content, /^name: example$/m);
  assert.match(content, /^ {2}renma\.id: 'skill\.example'$/m);
  assert.match(content, /^ {2}renma\.title: 'Evidence Review'$/m);
  assert.match(content, /^ {2}renma\.owner: 'qa-platform'$/m);
  assert.match(content, /^ {2}renma\.tags: '\["testing","review"\]'$/m);
  assert.deepEqual((await readdir(skillDirectory)).sort(), [
    "SKILL.md",
    "references",
  ]);
  assert.equal(
    (await stat(path.join(skillDirectory, "references"))).isDirectory(),
    true,
  );
  await assert.rejects(stat(path.join(root, "contexts")));
  await assert.rejects(stat(path.join(root, "lenses")));
  assert.doesNotMatch(content, /Confirmed|Proposed|Unresolved|Deferred/);
});

test("scaffold handoff prompt passes caller decisions through without epistemic promotion", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-handoff-prompt-"));
  const handoffPath = path.join(root, "handoff.json");
  const target = path.join(root, "skills", "example", "SKILL.md");
  await writeHandoff(handoffPath, gateReadyHandoff());

  const result = await capture(() =>
    main([
      "scaffold",
      "skill",
      target,
      "--handoff",
      handoffPath,
      "--format",
      "prompt",
    ]),
  );

  assert.equal(result.code, 0);
  assert.match(result.stdout, /Current understanding/);
  assert.match(result.stdout, /Confirmed:/);
  assert.match(result.stdout, /Proposed:/);
  assert.match(result.stdout, /Unresolved:/);
  assert.match(result.stdout, /Reversible defaults:/);
  assert.match(result.stdout, /Deferred:/);
  assert.match(
    result.stdout,
    /Recurring task: Review supplied implementation evidence/,
  );
  assert.match(result.stdout, /Declared source authorities/);
  assert.match(result.stdout, /designated_unconsulted/);
  assert.match(result.stdout, /Recorded security decisions/);
  assert.match(result.stdout, /Runtime unknown handling/);
  assert.match(
    result.stdout,
    /Re-enter clarification if new evidence creates a Blocking/,
  );
});

test("supporting Context and Lens relationships accept Renma ID-or-path forms without rewriting", async (t) => {
  const cases: Array<{
    name: string;
    field: "requiresContext" | "optionalContext" | "requiresLens";
    index: number;
    reference: string;
    metadataKey:
      | "renma.requires-context"
      | "renma.optional-context"
      | "renma.requires-lens";
  }> = [
    {
      name: "required Context by ID",
      field: "requiresContext",
      index: 0,
      reference: "context.testing.boundaries",
      metadataKey: "renma.requires-context",
    },
    {
      name: "required Context by repository-relative path",
      field: "requiresContext",
      index: 0,
      reference: "contexts/testing/boundaries.md",
      metadataKey: "renma.requires-context",
    },
    {
      name: "required Context by dot-relative repository path",
      field: "requiresContext",
      index: 0,
      reference: "./contexts/testing/boundaries.md",
      metadataKey: "renma.requires-context",
    },
    {
      name: "optional Context by path",
      field: "optionalContext",
      index: 0,
      reference: "contexts/testing/examples.md",
      metadataKey: "renma.optional-context",
    },
    {
      name: "required Lens by path",
      field: "requiresLens",
      index: 0,
      reference: "lenses/testing/risk.md",
      metadataKey: "renma.requires-lens",
    },
  ];

  for (const fixture of cases) {
    await t.test(fixture.name, async () => {
      const root = await mkdtemp(
        path.join(os.tmpdir(), "renma-handoff-relationship-"),
      );
      const handoffPath = path.join(root, "handoff.json");
      const target = path.join(root, "skills", "example", "SKILL.md");
      const handoff = gateReadyHandoff();
      handoff.assetGraph.skill[fixture.field][fixture.index] =
        fixture.reference;
      await writeHandoff(handoffPath, handoff);

      const result = await capture(() =>
        main([
          "scaffold",
          "skill",
          target,
          "--handoff",
          handoffPath,
          "--format",
          "json",
        ]),
      );

      assert.equal(result.code, 0);
      assert.equal(result.stderr, "");
      const bundle = JSON.parse(result.stdout) as {
        content: string;
        handoff: SkillAuthoringHandoff;
      };
      assert.equal(
        bundle.handoff.assetGraph.skill[fixture.field][fixture.index],
        fixture.reference,
      );
      assert.ok(
        bundle.content.includes(
          `  ${fixture.metadataKey}: '${JSON.stringify(bundle.handoff.assetGraph.skill[fixture.field])}'`,
        ),
      );
    });
  }
});

test("a supporting asset cannot be satisfied by a relationship of the wrong kind", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "renma-handoff-wrong-kind-"),
  );
  const handoffPath = path.join(root, "handoff.json");
  const target = path.join(root, "skills", "example", "SKILL.md");
  const handoff = gateReadyHandoff();
  handoff.assetGraph.skill.requiresContext = ["context.testing.other"];
  handoff.assetGraph.skill.requiresLens.push(
    "./contexts/testing/boundaries.md",
  );
  handoff.assetGraph.supportingAssets.push({
    kind: "context",
    id: "context.testing.other",
    path: "contexts/testing/other.md",
    disposition: "reuse",
    relationship: "required",
    justification: "A separate maintained testing policy.",
  });
  await writeHandoff(handoffPath, handoff);

  const result = await capture(() =>
    main([
      "scaffold",
      "skill",
      target,
      "--handoff",
      handoffPath,
      "--format",
      "json",
    ]),
  );

  assert.equal(result.code, 2);
  assert.equal(result.stdout, "");
  assert.match(
    result.stderr,
    /Supporting context "context\.testing\.boundaries" is marked required but is absent from the matching Skill relationship list/,
  );
});

test("Blocking handoff decisions return exit 2 and cause no filesystem side effects", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-handoff-blocked-"));
  const handoffPath = path.join(root, "handoff.json");
  const target = path.join(root, "skills", "example", "SKILL.md");
  const handoff = gateReadyHandoff();
  handoff.progression.blocking = ["Who owns this workflow?"];
  await writeHandoff(handoffPath, handoff);

  const result = await capture(() =>
    main(["scaffold", "skill", target, "--handoff", handoffPath]),
  );

  assert.equal(result.code, 2);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /still contains 1 Blocking decision/);
  assert.match(result.stderr, /Resolve it before scaffolding/);
  await assertNoScaffoldSideEffects(target);
});

test("handoff target mismatch returns exit 2 and writes nothing", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-handoff-mismatch-"));
  const handoffPath = path.join(root, "handoff.json");
  const target = path.join(root, "skills", "different", "SKILL.md");
  await writeHandoff(handoffPath, gateReadyHandoff());

  const result = await capture(() =>
    main(["scaffold", "skill", target, "--handoff", handoffPath]),
  );

  assert.equal(result.code, 2);
  assert.match(result.stderr, /does not match handoff Skill path/);
  await assertNoScaffoldSideEffects(target);
});

test("malformed and inconsistent handoffs are caller errors with no writes", async (t) => {
  const cases: Array<{
    name: string;
    mutate?: (handoff: SkillAuthoringHandoff) => void;
    raw?: string;
    targetRelative?: string;
    expected: RegExp;
  }> = [
    {
      name: "invalid JSON",
      raw: "{not-json",
      expected: /not valid JSON/,
    },
    {
      name: "unsupported schema version",
      mutate: (handoff) => {
        (handoff as { schemaVersion: string }).schemaVersion =
          "renma.skill-authoring-handoff.v2";
      },
      expected: /Unsupported.*schemaVersion/,
    },
    {
      name: "wrong topic",
      mutate: (handoff) => {
        (handoff as { topic: string }).topic = "context";
      },
      expected: /topic must be "skill"/,
    },
    {
      name: "missing owner",
      mutate: (handoff) => {
        delete (
          handoff.assetGraph.skill as Partial<typeof handoff.assetGraph.skill>
        ).owner;
      },
      expected: /missing required field: owner/,
    },
    {
      name: "unowned owner",
      mutate: (handoff) => {
        handoff.assetGraph.skill.owner = "unowned";
      },
      expected: /"unowned" is not allowed/,
    },
    {
      name: "invalid Skill path",
      mutate: (handoff) => {
        handoff.assetGraph.skill.path = "skills/Bad_Name/SKILL.md";
      },
      targetRelative: "skills/Bad_Name/SKILL.md",
      expected: /invalid Agent Skills name/,
    },
    {
      name: "required and optional Context overlap",
      mutate: (handoff) => {
        handoff.assetGraph.skill.optionalContext.push(
          "context.testing.boundaries",
        );
      },
      expected: /requiresContext.*optionalContext.*overlap/,
    },
    {
      name: "unsupported resource",
      mutate: (handoff) => {
        (handoff.assetGraph.skill.resources as string[]).push("examples");
      },
      expected: /resources\[1\].*references, scripts, assets/,
    },
    {
      name: "supporting relationship mismatch",
      mutate: (handoff) => {
        handoff.assetGraph.supportingAssets[0]!.relationship = "optional";
      },
      expected: /marked optional.*absent from the matching/,
    },
  ];

  for (const fixture of cases) {
    await t.test(fixture.name, async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), "renma-handoff-bad-"));
      const handoffPath = path.join(root, "handoff.json");
      const target = path.join(
        root,
        ...(fixture.targetRelative ?? "skills/example/SKILL.md").split("/"),
      );
      if (fixture.raw !== undefined) {
        await writeFile(handoffPath, fixture.raw);
      } else {
        const handoff = gateReadyHandoff();
        fixture.mutate?.(handoff);
        await writeHandoff(handoffPath, handoff);
      }

      const result = await capture(() =>
        main(["scaffold", "skill", target, "--handoff", handoffPath]),
      );
      assert.equal(result.code, 2);
      assert.equal(result.stdout, "");
      assert.match(result.stderr, fixture.expected);
      await assertNoScaffoldSideEffects(target);
    });
  }
});

test("missing handoff and mixed structural CLI authorities return exit 2", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-handoff-cli-"));
  const target = path.join(root, "skills", "example", "SKILL.md");
  const missing = path.join(root, "missing.json");
  const missingResult = await capture(() =>
    main(["scaffold", "skill", target, "--handoff", missing]),
  );
  assert.equal(missingResult.code, 2);
  assert.match(missingResult.stderr, /Cannot read Skill authoring handoff/);

  const handoffPath = path.join(root, "handoff.json");
  await writeHandoff(handoffPath, gateReadyHandoff());
  for (const args of [
    ["--id", "different"],
    ["--title", "Different"],
    ["--owner", "other-team"],
    ["--tags", "other"],
    ["--resources", "scripts"],
  ]) {
    const result = await capture(() =>
      main(["scaffold", "skill", target, "--handoff", handoffPath, ...args]),
    );
    assert.equal(result.code, 2, args.join(" "));
    assert.match(result.stderr, /--handoff cannot be combined/);
  }
  const wrongKind = await capture(() =>
    main([
      "scaffold",
      "context",
      path.join(root, "contexts", "example.md"),
      "--handoff",
      handoffPath,
    ]),
  );
  assert.equal(wrongKind.code, 2);
  assert.match(wrongKind.stderr, /supported only for skill scaffolds/);
  await assertNoScaffoldSideEffects(target);
});

test("handoff read error classification preserves PR #188 exit taxonomy", () => {
  for (const code of ["ENOENT", "EACCES", "EPERM", "EISDIR", "ENOTDIR"]) {
    const error = errorWithCode(code);
    const classified = classifySkillAuthoringHandoffReadError(
      error,
      "/tmp/handoff.json",
    );
    assert.ok(classified instanceof CliUserError, code);
    assert.equal(classified.cause, error, code);
    assert.equal(
      classifyCliError(classified).exitCode,
      CLI_EXIT.userError,
      code,
    );
  }

  for (const code of ["EIO", "EMFILE"]) {
    const error = errorWithCode(code);
    const classified = classifySkillAuthoringHandoffReadError(
      error,
      "/tmp/handoff.json",
    );
    assert.equal(classified, error, code);
    assert.equal(classified instanceof CliUserError, false, code);
    assert.equal(
      classifyCliError(classified).exitCode,
      CLI_EXIT.internalError,
      code,
    );
  }
});

test("guide prompt and JSON expose the v1 handoff construction contract", async () => {
  const jsonResult = await capture(() =>
    main(["guide", "skill", "--format", "json"]),
  );
  const promptResult = await capture(() => main(["guide", "skill"]));
  assert.equal(jsonResult.code, 0);
  const guide = JSON.parse(jsonResult.stdout) as {
    handoff: {
      schemaVersion: string;
      purpose: string;
      boundary: string;
      rules: string[];
      template: SkillAuthoringHandoff;
    };
  };
  assert.equal(
    guide.handoff.schemaVersion,
    SKILL_AUTHORING_HANDOFF_SCHEMA_VERSION,
  );
  assert.equal(guide.handoff.template.progression.blocking.length, 0);
  assert.match(guide.handoff.boundary, /does not prove/);
  assert.match(guide.handoff.rules.join("\n"), /Proposed reversible defaults/);
  assert.match(promptResult.stdout, /Structured guide-to-scaffold handoff/);
  assert.match(promptResult.stdout, /renma\.skill-authoring-handoff\.v1/);
  assert.match(
    promptResult.stdout,
    /no Blocking authoring decision remains.*construct.*handoff/is,
  );
  assert.match(
    promptResult.stdout,
    /renma scaffold skill <agreed-path> --handoff <handoff\.json>/,
  );
  assert.match(promptResult.stdout, /does not certify.*claims are true/i);
});

test("guide and scaffold help make the caller-declared handoff workflow discoverable", async () => {
  const guideHelp = await capture(() => main(["guide", "--help"]));
  const scaffoldHelp = await capture(() => main(["scaffold", "--help"]));
  assert.equal(guideHelp.code, 0);
  assert.match(guideHelp.stdout, /renma\.skill-authoring-handoff\.v1/);
  assert.match(
    guideHelp.stdout,
    /renma scaffold skill <agreed-path> --handoff <handoff\.json>/,
  );
  assert.equal(scaffoldHelp.code, 0);
  assert.match(scaffoldHelp.stdout, /--handoff <path>/);
  assert.match(scaffoldHelp.stdout, /caller-declared authoring evidence/i);
  assert.match(scaffoldHelp.stdout, /does not prove.*human review/is);
  assert.match(scaffoldHelp.stdout, /Do not combine --handoff with --id/);
});

test("published handoff schema validates the guide template and bounds malformed shapes", async () => {
  const schema = JSON.parse(
    await readFile(SCHEMA_PATH, "utf8"),
  ) as AnySchemaObject;
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  const validate = ajv.compile(schema);
  const template = buildSkillAuthoringGuidance("test").handoff.template;
  assert.equal(validate(template), true, JSON.stringify(validate.errors));

  const invalid = structuredClone(template) as unknown as Record<
    string,
    unknown
  >;
  invalid.unknown = true;
  assert.equal(validate(invalid), false);
  assert.ok(
    validate.errors?.some((error) => error.keyword === "additionalProperties"),
  );
});

test("existing scaffold JSON remains compatible when no handoff is supplied", async () => {
  const result = await capture(() =>
    main([
      "scaffold",
      "skill",
      "skills/compatibility/SKILL.md",
      "--owner",
      "team",
      "--format",
      "json",
    ]),
  );
  assert.equal(result.code, 0);
  const bundle = JSON.parse(result.stdout) as Record<string, unknown>;
  assert.deepEqual(Object.keys(bundle), [
    "kind",
    "path",
    "id",
    "title",
    "owner",
    "tags",
    "resources",
    "format",
    "content",
    "prompt",
  ]);
  assert.equal("handoff" in bundle, false);
  assert.doesNotMatch(String(bundle.content), /renma\.requires-lens/);
});

function gateReadyHandoff(): SkillAuthoringHandoff {
  return {
    schemaVersion: SKILL_AUTHORING_HANDOFF_SCHEMA_VERSION,
    topic: "skill",
    currentUnderstanding: {
      confirmed: [
        "The Skill reviews supplied implementation evidence against declared requirements.",
      ],
      proposed: ["Report findings before proposing edits."],
      unresolved: ["Final report wording remains open."],
    },
    progression: {
      blocking: [],
      reversibleDefaults: ["Report findings before proposing edits."],
      deferred: ["Choose final report wording during prose authoring."],
    },
    skillContract: {
      recurringTask: "Review supplied implementation evidence.",
      expectedResult: "An evidence-backed findings report.",
      requiredInputs: ["Declared requirements", "Implementation evidence"],
      completionCriteria: [
        "Every declared requirement has an evidence-backed disposition.",
      ],
      failureBehavior: [
        "Report missing evidence and stop before claiming compliance.",
      ],
      useWhen: ["A maintainer requests an implementation evidence review."],
      doNotUseWhen: ["The task is to edit implementation automatically."],
    },
    assetGraph: {
      skill: {
        path: "skills/example/SKILL.md",
        id: "skill.example",
        title: "Evidence Review",
        owner: "qa-platform",
        tags: ["testing", "review"],
        resources: ["references"],
        requiresContext: ["context.testing.boundaries"],
        optionalContext: ["context.testing.examples"],
        requiresLens: ["lens.testing.risk"],
        optionalLens: [],
      },
      supportingAssets: [
        {
          kind: "context",
          id: "context.testing.boundaries",
          path: "contexts/testing/boundaries.md",
          disposition: "reuse",
          relationship: "required",
          justification:
            "Independent source-backed testing policy with a separate maintenance lifecycle.",
        },
        {
          kind: "context",
          id: "context.testing.examples",
          path: "contexts/testing/examples.md",
          disposition: "create",
          relationship: "optional",
          justification:
            "Reusable reviewed examples maintained separately from the workflow.",
        },
        {
          kind: "context_lens",
          id: "lens.testing.risk",
          path: "lenses/testing/risk.md",
          disposition: "reuse",
          relationship: "required",
          justification:
            "Reusable risk interpretation of the declared testing contexts.",
        },
      ],
    },
    sourceAuthorities: [
      {
        source: "https://example.test/testing-policy",
        status: "designated_unconsulted",
        authority:
          "The caller designates this URL as the intended policy source.",
      },
    ],
    securityDecisions: [
      {
        decision:
          "The finished Skill does not infer network permission from URLs.",
        state: "confirmed",
      },
    ],
    runtimeUnknownHandling: [
      {
        unknown: "A required implementation artifact is unavailable.",
        behavior: "report",
        condition: "Report the missing evidence before evaluating compliance.",
      },
    ],
  };
}

async function writeHandoff(
  handoffPath: string,
  handoff: SkillAuthoringHandoff,
): Promise<void> {
  await mkdir(path.dirname(handoffPath), { recursive: true });
  await writeFile(handoffPath, `${JSON.stringify(handoff, null, 2)}\n`);
}

async function assertNoScaffoldSideEffects(target: string): Promise<void> {
  await assert.rejects(stat(target));
  await assert.rejects(stat(path.join(path.dirname(target), "references")));
  await assert.rejects(stat(path.join(path.dirname(target), "scripts")));
  await assert.rejects(stat(path.join(path.dirname(target), "assets")));
}

function errorWithCode(code: string): Error & { code: string } {
  return Object.assign(new Error(`${code} fixture`), { code });
}

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
