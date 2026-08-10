import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import fc from "fast-check";

import { bom, formatBomMarkdown } from "../src/commands/bom.js";
import {
  BUILT_IN_EXECUTABLE_DEPENDENCY_ANALYZERS,
  collectExecutableDependencyCandidates,
} from "../src/executable-dependency-analyzer.js";
import { JS_TS_EXECUTABLE_DEPENDENCY_ANALYZER } from "../src/executable-dependency-js-ts.js";
import { PYTHON_EXECUTABLE_DEPENDENCY_ANALYZER } from "../src/executable-dependency-python.js";
import { SHELL_EXECUTABLE_DEPENDENCY_ANALYZER } from "../src/executable-dependency-shell.js";
import {
  canonicalExecutableDependencyGraphEdges,
  resolveExecutableDependencies,
} from "../src/executable-dependency-resolution.js";
import { buildExecutableSurfaceDiff } from "../src/executable-surface-diff.js";
import { parseDocument } from "../src/markdown.js";
import { collectRepositorySnapshot } from "../src/repository-evidence.js";
import {
  formatExecutableSurfaceInventoryText,
  formatJson,
  formatText,
} from "../src/report.js";
import { scan } from "../src/scanner.js";
import type { Artifact } from "../src/types/artifact.js";

test("built-in analyzer registry is fixed, ordered, and extension bounded", () => {
  assert.deepEqual(
    BUILT_IN_EXECUTABLE_DEPENDENCY_ANALYZERS.map((analyzer) => analyzer.id),
    ["js-ts", "python", "shell"],
  );
  for (const extension of [".js", ".mjs", ".ts", ".mts", ".cts"]) {
    assert.equal(
      JS_TS_EXECUTABLE_DEPENDENCY_ANALYZER.supports({
        path: `tools/check${extension}`,
        contentClassification: "text",
      }),
      true,
    );
  }
  for (const extension of [".cjs", ".jsx", ".tsx", ".py", ".rb"]) {
    assert.equal(
      JS_TS_EXECUTABLE_DEPENDENCY_ANALYZER.supports({
        path: `tools/check${extension}`,
        contentClassification: "text",
      }),
      false,
    );
  }
  assert.equal(
    PYTHON_EXECUTABLE_DEPENDENCY_ANALYZER.supports({
      path: "tools/check.py",
      contentClassification: "text",
    }),
    true,
  );
  for (const extension of [".pyi", ".pyc", ".js"]) {
    assert.equal(
      PYTHON_EXECUTABLE_DEPENDENCY_ANALYZER.supports({
        path: `tools/check${extension}`,
        contentClassification: "text",
      }),
      false,
    );
  }
  assert.equal(
    PYTHON_EXECUTABLE_DEPENDENCY_ANALYZER.supports({
      path: "tools/check.py",
      contentClassification: "binary",
    }),
    false,
  );
  for (const extension of [".sh", ".bash"]) {
    assert.equal(
      SHELL_EXECUTABLE_DEPENDENCY_ANALYZER.supports({
        path: `tools/check${extension}`,
        contentClassification: "text",
      }),
      true,
    );
  }
  for (const extension of [".zsh", ".fish", ".command", ".js"]) {
    assert.equal(
      SHELL_EXECUTABLE_DEPENDENCY_ANALYZER.supports({
        path: `tools/check${extension}`,
        contentClassification: "text",
      }),
      false,
    );
  }
  assert.equal(
    SHELL_EXECUTABLE_DEPENDENCY_ANALYZER.supports({
      path: "tools/check.sh",
      contentClassification: "binary",
    }),
    false,
  );
});

test("shell collector recognizes only bounded static relative execution and source forms", () => {
  const content = [
    "./direct.sh",
    "bash ./bash-helper.sh",
    "sh '../shared/sh-helper.sh'",
    'source "./lib.sh"',
    ". './dot-lib.bash'",
    '"./quoted.sh" --check',
    "./direct.sh",
    "bash $HELPER",
    'sh "${HELPER}"',
    "source $(helper_path)",
    ". `helper_path`",
    "bash /opt/vendor/external.sh",
    "source https://example.com/external.sh",
    "helper.sh",
    "bash -e ./option-helper.sh",
    "env bash ./env-helper.sh",
    "# ./comment.sh",
    "echo ./argument.sh",
    '"./quoted.sh"suffix',
  ].join("\n");
  const first = SHELL_EXECUTABLE_DEPENDENCY_ANALYZER.collect({
    path: "tools/sub/check.sh",
    content,
  });
  const second = SHELL_EXECUTABLE_DEPENDENCY_ANALYZER.collect({
    path: "tools/sub/check.sh",
    content,
  });

  assert.deepEqual(second, first);
  assert.deepEqual(
    first.map((candidate) => ({
      line: candidate.line,
      relation: candidate.relation,
      rawSpecifier: candidate.rawSpecifier,
      targets: candidate.normalizedTargetCandidates,
      unsafe: candidate.unsafe,
    })),
    [
      {
        line: 1,
        relation: "static-execution",
        rawSpecifier: "./direct.sh",
        targets: ["tools/sub/direct.sh"],
        unsafe: false,
      },
      {
        line: 2,
        relation: "static-execution",
        rawSpecifier: "./bash-helper.sh",
        targets: ["tools/sub/bash-helper.sh"],
        unsafe: false,
      },
      {
        line: 3,
        relation: "static-execution",
        rawSpecifier: "../shared/sh-helper.sh",
        targets: ["tools/shared/sh-helper.sh"],
        unsafe: false,
      },
      {
        line: 4,
        relation: "static-source",
        rawSpecifier: "./lib.sh",
        targets: ["tools/sub/lib.sh"],
        unsafe: false,
      },
      {
        line: 5,
        relation: "static-source",
        rawSpecifier: "./dot-lib.bash",
        targets: ["tools/sub/dot-lib.bash"],
        unsafe: false,
      },
      {
        line: 6,
        relation: "static-execution",
        rawSpecifier: "./quoted.sh",
        targets: ["tools/sub/quoted.sh"],
        unsafe: false,
      },
      {
        line: 7,
        relation: "static-execution",
        rawSpecifier: "./direct.sh",
        targets: ["tools/sub/direct.sh"],
        unsafe: false,
      },
    ],
  );
  assert.ok(first.every((candidate) => candidate.snippet.length <= 240));
});

test("shell collector skips heredoc, multiline literal, and continued data regions", () => {
  const content = [
    "cat <<'EOF'",
    "./heredoc-worker.sh",
    "source ./heredoc-lib.sh",
    "EOF",
    "cat <<-TAB_EOF",
    "\t./tab-heredoc-worker.sh",
    "\tTAB_EOF",
    "payload='",
    "./single-quoted-worker.sh",
    "'",
    'payload="',
    "bash ./double-quoted-worker.sh",
    '"',
    "printf '%s\\n' \\",
    "./continued-argument.sh",
    "./real-worker.sh",
  ].join("\n");

  const candidates = SHELL_EXECUTABLE_DEPENDENCY_ANALYZER.collect({
    path: "tools/check.sh",
    content,
  });

  assert.deepEqual(
    candidates.map((candidate) => ({
      line: candidate.line,
      rawSpecifier: candidate.rawSpecifier,
      relation: candidate.relation,
    })),
    [
      {
        line: 16,
        rawSpecifier: "./real-worker.sh",
        relation: "static-execution",
      },
    ],
  );
});

test("an unsupported dynamic heredoc delimiter fails closed for later topology", () => {
  for (const content of [
    "cat <<$DELIMITER\n./not-a-command.sh\n$DELIMITER\n./later.sh\n",
    "cat <<EOF#suffix\n./not-a-command.sh\nEOF#suffix\n./later.sh\n",
  ]) {
    const candidates = SHELL_EXECUTABLE_DEPENDENCY_ANALYZER.collect({
      path: "tools/check.sh",
      content,
    });

    assert.deepEqual(candidates, []);
  }
});

test("shell collector retains repository-escape evidence without inventing a target", () => {
  const [candidate] = SHELL_EXECUTABLE_DEPENDENCY_ANALYZER.collect({
    path: "tools/check.sh",
    content: "bash ../../outside.sh\n",
  });

  assert.equal(candidate?.unsafe, true);
  assert.deepEqual(candidate?.normalizedTargetCandidates, []);
});

test("JS and TypeScript collector recognizes only bounded static declarations", () => {
  const content = [
    'import "./side.js";',
    "import value from '../default.mjs'",
    'import { value } from "./named.ts";',
    "import * as helper",
    '  from "./namespace.mts"',
    'export { value } from "./named-export.cts";',
    "export *",
    '  from "./star.cjs"',
    'import data from "./data.py" with { type: "json" };',
    'import shell from "./run.sh";',
    'import bash from "./run.bash";',
    '// import "./comment.js";',
    '/* export * from "./block.js"; */',
    "const text = 'import \"./string.js\"';",
    'const template = `import "./template.js"`;',
    'const escaped = "quote \\" import \\"./escaped.js\\"";',
    "import.meta.url;",
    'import("./dynamic.js");',
    'require("./required.cjs");',
    'import packageName from "package-name";',
    'import fs from "node:fs";',
    'import absolute from "/absolute.js";',
    'import query from "./query.js?mode=test";',
    'import fragment from "./fragment.js#part";',
    'import type { Value } from "./types.ts";',
    'export type { Value } from "./types.ts";',
    'import Value = require("./assignment.js");',
    'import extensionless from "./extensionless";',
  ].join("\n");
  const candidates = JS_TS_EXECUTABLE_DEPENDENCY_ANALYZER.collect({
    path: "tools/sub/check.ts",
    content,
  });

  assert.deepEqual(
    candidates.map((candidate) => ({
      relation: candidate.relation,
      rawSpecifier: candidate.rawSpecifier,
      targets: candidate.normalizedTargetCandidates,
    })),
    [
      {
        relation: "static-import",
        rawSpecifier: "./side.js",
        targets: ["tools/sub/side.js"],
      },
      {
        relation: "static-import",
        rawSpecifier: "../default.mjs",
        targets: ["tools/default.mjs"],
      },
      {
        relation: "static-import",
        rawSpecifier: "./named.ts",
        targets: ["tools/sub/named.ts"],
      },
      {
        relation: "static-import",
        rawSpecifier: "./namespace.mts",
        targets: ["tools/sub/namespace.mts"],
      },
      {
        relation: "static-reexport",
        rawSpecifier: "./named-export.cts",
        targets: ["tools/sub/named-export.cts"],
      },
      {
        relation: "static-reexport",
        rawSpecifier: "./star.cjs",
        targets: ["tools/sub/star.cjs"],
      },
      {
        relation: "static-import",
        rawSpecifier: "./data.py",
        targets: ["tools/sub/data.py"],
      },
      {
        relation: "static-import",
        rawSpecifier: "./run.sh",
        targets: ["tools/sub/run.sh"],
      },
      {
        relation: "static-import",
        rawSpecifier: "./run.bash",
        targets: ["tools/sub/run.bash"],
      },
    ],
  );
  assert.deepEqual(
    candidates.map((candidate) => candidate.line),
    [1, 2, 3, 4, 6, 7, 9, 10, 11],
  );
  assert.ok(candidates.every((candidate) => candidate.snippet.length <= 240));
});

test("JS and TypeScript collector excludes only pure inline type-only named clauses", () => {
  const typeOnlyDeclarations = [
    'import { type Foo } from "./one-import.ts";',
    'import { type Foo, type Bar as Alias } from "./many-imports.ts";',
    'export { type Foo } from "./one-export.ts";',
    'export { type Foo, type Bar as Alias } from "./many-exports.ts";',
    [
      "import {",
      "  type Foo,",
      "  type Bar as Alias,",
      '} from "./multiline-import.ts";',
    ].join("\n"),
    [
      "export {",
      "  type Foo,",
      "  type Bar as Alias,",
      '} from "./multiline-export.ts";',
    ].join("\n"),
  ];
  for (const content of typeOnlyDeclarations) {
    assert.deepEqual(
      JS_TS_EXECUTABLE_DEPENDENCY_ANALYZER.collect({
        path: "tools/check.ts",
        content,
      }),
      [],
    );
  }

  const runtimeDeclarations = [
    'import { type Foo, runtimeValue } from "./mixed-import.ts";',
    'export { type Foo, runtimeValue } from "./mixed-export.ts";',
    'import runtimeDefault, { type Foo } from "./default-import.ts";',
    'import * as runtimeNamespace from "./namespace-import.ts";',
    'import { type } from "./literal-type.ts";',
    'import { type as renamed } from "./renamed-type.ts";',
  ].join("\n");
  const first = JS_TS_EXECUTABLE_DEPENDENCY_ANALYZER.collect({
    path: "tools/check.ts",
    content: runtimeDeclarations,
  });
  const second = JS_TS_EXECUTABLE_DEPENDENCY_ANALYZER.collect({
    path: "tools/check.ts",
    content: runtimeDeclarations,
  });
  assert.deepEqual(
    first.map((candidate) => [candidate.relation, candidate.rawSpecifier]),
    [
      ["static-import", "./mixed-import.ts"],
      ["static-reexport", "./mixed-export.ts"],
      ["static-import", "./default-import.ts"],
      ["static-import", "./namespace-import.ts"],
      ["static-import", "./literal-type.ts"],
      ["static-import", "./renamed-type.ts"],
    ],
  );
  assert.deepEqual(first, second);
});

test("JS and TypeScript normalization rejects repository escape without substitution", () => {
  const candidates = JS_TS_EXECUTABLE_DEPENDENCY_ANALYZER.collect({
    path: "tools/check.mjs",
    content: ['import "../../../outside.js";', 'import "./exact.js";'].join(
      "\n",
    ),
  });
  assert.equal(candidates[0]?.unsafe, true);
  assert.deepEqual(candidates[0]?.normalizedTargetCandidates, []);
  assert.deepEqual(candidates[1]?.normalizedTargetCandidates, [
    "tools/exact.js",
  ]);
});

test("Python collector recognizes explicit relative modules and imported module names", () => {
  const content = [
    "from .helper import run",
    "from ..shared.helper import run",
    "from . import helper",
    "from . import helper as helper_alias, parser",
    "from . import (",
    "  alpha,",
    "  beta as beta_alias,",
    ")",
    "from . import gamma, \\",
    "  delta",
    "# from .comment import nope",
    'text = "from .string import nope"',
    "other = '''from .triple import nope'''",
    "import helper",
    "import package.helper",
    "from package.helper import run",
    "importlib.import_module(name)",
    "__import__(name)",
  ].join("\n");
  const candidates = PYTHON_EXECUTABLE_DEPENDENCY_ANALYZER.collect({
    path: "tools/setup/check.py",
    content,
  });

  assert.deepEqual(
    candidates.map((candidate) => candidate.rawSpecifier),
    [
      ".helper",
      "..shared.helper",
      ".helper",
      ".helper",
      ".parser",
      ".alpha",
      ".beta",
      ".gamma",
      ".delta",
    ],
  );
  assert.deepEqual(candidates[0]?.normalizedTargetCandidates, [
    "tools/setup/helper.py",
    "tools/setup/helper/__init__.py",
  ]);
  assert.deepEqual(candidates[1]?.normalizedTargetCandidates, [
    "tools/shared/helper.py",
    "tools/shared/helper/__init__.py",
  ]);
  assert.deepEqual(
    candidates.map((candidate) => candidate.line),
    [1, 2, 3, 4, 4, 5, 5, 9, 9],
  );
});

test("generic resolver preserves ambiguity, scope, unavailable state, and ordinals", () => {
  const candidates = [
    pythonCandidate("tools/check.py", ".helper", [
      "tools/helper.py",
      "tools/helper/__init__.py",
    ]),
    pythonCandidate("tools/check.py", ".missing", [
      "tools/missing.py",
      "tools/missing/__init__.py",
    ]),
    pythonCandidate("tools/check.py", ".outside", [], true),
    pythonCandidate("tools/check.py", ".not_inventory", [
      "tools/not_inventory.py",
    ]),
    pythonCandidate("tools/check.py", ".noncanonical", [
      "contexts/scripts/noncanonical.py",
    ]),
    pythonCandidate("tools/check.py", ".excluded", ["tools/excluded.py"]),
    pythonCandidate("tools/check.py", ".repeat", ["tools/repeat.py"]),
    pythonCandidate("tools/check.py", ".repeat", ["tools/repeat.py"]),
  ];
  const dependencies = resolveExecutableDependencies(
    candidates,
    new Map([
      ["tools/helper.py", "parsed"],
      ["tools/helper/__init__.py", "parsed"],
      ["tools/not_inventory.py", "parsed"],
      ["contexts/scripts/noncanonical.py", "parsed"],
      ["tools/excluded.py", "excluded"],
      ["tools/repeat.py", "parsed"],
    ]),
    new Map([
      ["contexts/scripts/noncanonical.py", "noncanonical"],
      ["tools/repeat.py", "repository-tool"],
    ]),
  );

  assert.deepEqual(
    Object.fromEntries(
      dependencies.map((dependency) => [
        dependency.rawSpecifier,
        dependency.resolution,
      ]),
    ),
    {
      ".helper": "ambiguous",
      ".missing": "missing",
      ".outside": "unsafe",
      ".not_inventory": "not-inventory",
      ".noncanonical": "noncanonical",
      ".excluded": "excluded",
      ".repeat": "resolved",
    },
  );
  assert.equal(
    dependencies.find((dependency) => dependency.rawSpecifier === ".excluded")
      ?.targetPathState,
    "excluded",
  );
  // Exact duplicate evidence is the only evidence deduplicated.
  assert.equal(
    dependencies.filter((dependency) => dependency.rawSpecifier === ".repeat")
      .length,
    1,
  );
});

test("repeated dependency declarations retain stable occurrence ordinals", () => {
  const candidates = JS_TS_EXECUTABLE_DEPENDENCY_ANALYZER.collect({
    path: "tools/check.mjs",
    content: 'import "./helper.mjs";\nimport "./helper.mjs";\n',
  });
  const dependencies = resolveExecutableDependencies(
    candidates,
    new Map([["tools/helper.mjs", "parsed"]]),
    new Map([["tools/helper.mjs", "repository-tool"]]),
  );
  assert.deepEqual(
    dependencies.map((dependency) => dependency.occurrenceOrdinal),
    [1, 2],
  );
});

test("identical same-line JS declarations retain separate public evidence rows", () => {
  for (const [content, relation] of [
    ['import "./helper.mjs"; import "./helper.mjs";', "static-import"],
    [
      'export * from "./helper.mjs"; export * from "./helper.mjs";',
      "static-reexport",
    ],
  ] as const) {
    const candidates = JS_TS_EXECUTABLE_DEPENDENCY_ANALYZER.collect({
      path: "tools/check.mjs",
      content,
    });
    const dependencies = resolveExecutableDependencies(
      candidates,
      new Map([["tools/helper.mjs", "parsed"]]),
      new Map([["tools/helper.mjs", "repository-tool"]]),
    );
    assert.equal(candidates.length, 2);
    assert.deepEqual(
      dependencies.map((dependency) => ({
        line: dependency.line,
        relation: dependency.relation,
        occurrenceOrdinal: dependency.occurrenceOrdinal,
        exposesPrivateOffset: Object.hasOwn(dependency, "declarationOffset"),
      })),
      [
        {
          line: 1,
          relation,
          occurrenceOrdinal: 1,
          exposesPrivateOffset: false,
        },
        {
          line: 1,
          relation,
          occurrenceOrdinal: 2,
          exposesPrivateOffset: false,
        },
      ],
    );
  }
});

test("shell dependency evidence propagates through graph reachability and semantic diff", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-shell-dependency-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "skills", "demo"), { recursive: true });
  await mkdir(path.join(root, "tools"), { recursive: true });
  await writeFile(
    path.join(root, "skills", "demo", "SKILL.md"),
    [
      "---",
      "name: demo",
      "description: Check shell dependencies. Use when static execution evidence needs review.",
      "---",
      "# Demo",
      "```sh",
      "bash tools/entry.sh",
      "```",
    ].join("\n"),
  );
  await writeFile(path.join(root, "tools", "entry.sh"), "#!/bin/sh\n");
  await writeFile(path.join(root, "tools", "lib.sh"), "#!/bin/sh\n");
  await writeFile(path.join(root, "tools", "worker.sh"), "#!/bin/sh\n");
  await writeFile(path.join(root, "tools", "heredoc-only.sh"), "#!/bin/sh\n");

  const before = (await collectRepositorySnapshot(root))
    .executableSurfaceInventory;
  await writeFile(
    path.join(root, "tools", "entry.sh"),
    [
      "#!/bin/sh",
      "source ./lib.sh",
      '. "./lib.sh"',
      "bash ./worker.sh",
      "./worker.sh",
      "bash $DYNAMIC_HELPER",
      "bash /opt/vendor/external.sh",
      "cat <<'EOF'",
      "./heredoc-only.sh",
      "EOF",
      "",
    ].join("\n"),
  );

  const after = (await collectRepositorySnapshot(root))
    .executableSurfaceInventory;
  assert.deepEqual(
    after.dependencies.map((dependency) => ({
      analyzer: dependency.analyzer,
      relation: dependency.relation,
      target: dependency.normalizedTarget,
      ordinal: dependency.occurrenceOrdinal,
    })),
    [
      {
        analyzer: "shell",
        relation: "static-source",
        target: "tools/lib.sh",
        ordinal: 1,
      },
      {
        analyzer: "shell",
        relation: "static-source",
        target: "tools/lib.sh",
        ordinal: 2,
      },
      {
        analyzer: "shell",
        relation: "static-execution",
        target: "tools/worker.sh",
        ordinal: 1,
      },
      {
        analyzer: "shell",
        relation: "static-execution",
        target: "tools/worker.sh",
        ordinal: 2,
      },
    ],
  );
  assert.deepEqual(
    canonicalExecutableDependencyGraphEdges(after.dependencies),
    [
      { sourcePath: "tools/entry.sh", normalizedTarget: "tools/lib.sh" },
      { sourcePath: "tools/entry.sh", normalizedTarget: "tools/worker.sh" },
    ],
  );
  assert.equal(
    surface(after, "tools/lib.sh").dependencyEvidence
      .staticInvocationReachability,
    "transitive",
  );
  assert.equal(
    surface(after, "tools/worker.sh").dependencyEvidence
      .minimumInvocationDependencyDepth,
    1,
  );
  assert.equal(
    surface(after, "tools/heredoc-only.sh").dependencyEvidence
      .staticInvocationReachability,
    "unreached",
  );

  const diff = buildExecutableSurfaceDiff(before, after);
  assert.equal(diff.addedDependencies.length, 4);
  assert.ok(
    diff.changedSurfaces.some(
      (change) =>
        change.path === "tools/entry.sh" &&
        change.reasons.includes("dependency-graph"),
    ),
  );
});

test("pure inline type-only imports do not create transitive reachability", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-inline-types-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "skills", "demo"), { recursive: true });
  await mkdir(path.join(root, "tools"), { recursive: true });
  await writeFile(
    path.join(root, "skills", "demo", "SKILL.md"),
    [
      "---",
      "name: demo",
      "description: Check inline type imports. Use when dependency evidence needs review.",
      "---",
      "# Demo",
      "```sh",
      "node tools/check.ts",
      "```",
    ].join("\n"),
  );
  await writeFile(
    path.join(root, "tools", "check.ts"),
    'import { type Foo, type Bar as Alias } from "./types.ts";\n',
  );
  await writeFile(
    path.join(root, "tools", "types.ts"),
    "export interface Foo {}\nexport interface Bar {}\n",
  );

  const typeOnly = (await collectRepositorySnapshot(root))
    .executableSurfaceInventory;
  assert.equal(typeOnly.dependencies.length, 0);
  assert.equal(
    surface(typeOnly, "tools/types.ts").dependencyEvidence
      .staticInvocationReachability,
    "unreached",
  );

  await writeFile(
    path.join(root, "tools", "check.ts"),
    'import { type Foo, runtimeValue } from "./types.ts";\nvoid runtimeValue;\n',
  );
  const mixed = (await collectRepositorySnapshot(root))
    .executableSurfaceInventory;
  assert.equal(mixed.dependencies.length, 1);
  assert.equal(mixed.dependencies[0]?.rawSpecifier, "./types.ts");
  assert.equal(
    surface(mixed, "tools/types.ts").dependencyEvidence
      .staticInvocationReachability,
    "transitive",
  );
});

test("dependency declarations remain auditable while graph edges are unique", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-unique-edges-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "skills", "demo"), { recursive: true });
  await mkdir(path.join(root, "tools"), { recursive: true });
  await writeFile(
    path.join(root, "skills", "demo", "SKILL.md"),
    [
      "---",
      "name: demo",
      "description: Check unique dependency edges. Use when graph evidence needs review.",
      "---",
      "# Demo",
      "```sh",
      "node tools/source.mjs",
      "```",
    ].join("\n"),
  );
  await writeFile(
    path.join(root, "tools", "source.mjs"),
    'import "./target.mjs";\n',
  );
  await writeFile(path.join(root, "tools", "target.mjs"), "export {};\n");

  const single = (await collectRepositorySnapshot(root))
    .executableSurfaceInventory;
  await writeFile(
    path.join(root, "tools", "source.mjs"),
    'import "./target.mjs"; import "./target.mjs";\n',
  );
  const duplicate = (await collectRepositorySnapshot(root))
    .executableSurfaceInventory;
  const duplicateAgain = (await collectRepositorySnapshot(root))
    .executableSurfaceInventory;
  assert.deepEqual(duplicateAgain, duplicate);
  assert.equal(duplicate.dependencies.length, 2);
  assert.equal(duplicate.summary.totalDependencies, 2);
  assert.deepEqual(
    duplicate.dependencies.map((dependency) => dependency.occurrenceOrdinal),
    [1, 2],
  );
  assert.deepEqual(
    canonicalExecutableDependencyGraphEdges(duplicate.dependencies),
    [
      {
        sourcePath: "tools/source.mjs",
        normalizedTarget: "tools/target.mjs",
      },
    ],
  );
  assert.deepEqual(surface(duplicate, "tools/source.mjs").dependencyEvidence, {
    incomingResolvedDependencyCount: 0,
    outgoingResolvedDependencyCount: 1,
    staticInvocationReachability: "direct",
    minimumInvocationDependencyDepth: 0,
  });
  assert.deepEqual(surface(duplicate, "tools/target.mjs").dependencyEvidence, {
    incomingResolvedDependencyCount: 1,
    outgoingResolvedDependencyCount: 0,
    staticInvocationReachability: "transitive",
    minimumInvocationDependencyDepth: 1,
  });

  const addedDuplicate = buildExecutableSurfaceDiff(single, duplicate);
  assert.equal(addedDuplicate.addedDependencies.length, 1);
  assert.ok(
    addedDuplicate.changedSurfaces.some(
      (change) =>
        change.path === "tools/source.mjs" &&
        change.reasons.includes("content") &&
        !change.reasons.includes("dependency-graph") &&
        !change.reasons.includes("invocation-reachability"),
    ),
  );
  assert.equal(
    addedDuplicate.changedSurfaces.some(
      (change) => change.path === "tools/target.mjs",
    ),
    false,
  );

  await writeFile(
    path.join(root, "tools", "source.mjs"),
    'import "./target.mjs";\nexport * from "./target.mjs";\n',
  );
  const importAndReexport = (await collectRepositorySnapshot(root))
    .executableSurfaceInventory;
  assert.equal(importAndReexport.dependencies.length, 2);
  assert.deepEqual(
    importAndReexport.dependencies.map((dependency) => dependency.relation),
    ["static-import", "static-reexport"],
  );
  assert.equal(
    surface(importAndReexport, "tools/source.mjs").dependencyEvidence
      .outgoingResolvedDependencyCount,
    1,
  );
  assert.equal(
    surface(importAndReexport, "tools/target.mjs").dependencyEvidence
      .incomingResolvedDependencyCount,
    1,
  );

  await writeFile(
    path.join(root, "tools", "source.mjs"),
    'import "./target.mjs";\n',
  );
  const oneRemaining = (await collectRepositorySnapshot(root))
    .executableSurfaceInventory;
  const removedDuplicate = buildExecutableSurfaceDiff(duplicate, oneRemaining);
  assert.equal(removedDuplicate.removedDependencies.length, 1);
  assert.equal(
    removedDuplicate.changedSurfaces.some((change) =>
      change.reasons.includes("dependency-graph"),
    ),
    false,
  );
  assert.equal(
    surface(oneRemaining, "tools/target.mjs").dependencyEvidence
      .minimumInvocationDependencyDepth,
    1,
  );

  await writeFile(path.join(root, "tools", "source.mjs"), "export {};\n");
  const noneRemaining = (await collectRepositorySnapshot(root))
    .executableSurfaceInventory;
  const removedFinal = buildExecutableSurfaceDiff(oneRemaining, noneRemaining);
  assert.equal(removedFinal.removedDependencies.length, 1);
  assert.ok(
    removedFinal.changedSurfaces.some(
      (change) =>
        change.path === "tools/source.mjs" &&
        change.reasons.includes("dependency-graph"),
    ),
  );
  assert.equal(
    surface(noneRemaining, "tools/target.mjs").dependencyEvidence
      .staticInvocationReachability,
    "unreached",
  );
});

test("repository snapshot projects shared JS/TS and Python dependencies into minimum-depth reachability", async (t) => {
  const root = await integrationFixture();
  t.after(() => rm(root, { recursive: true, force: true }));

  const snapshot = await collectRepositorySnapshot(root);
  const inventory = snapshot.executableSurfaceInventory;
  assert.deepEqual(inventory.summary.dependencyAnalyzers, [
    { analyzer: "js-ts", count: 3 },
    { analyzer: "python", count: 2 },
  ]);
  assert.equal(inventory.summary.resolvedDependencies, 5);
  assert.equal(inventory.summary.directlyInvokedSurfaces, 2);
  assert.equal(inventory.summary.transitivelyReachableSurfaces, 4);

  const check = surface(inventory, "tools/check-node-env.mjs");
  assert.equal(check.dependencyEvidence.staticInvocationReachability, "direct");
  assert.equal(check.dependencyEvidence.minimumInvocationDependencyDepth, 0);
  const helper = surface(inventory, "tools/env-check-helpers.mjs");
  assert.deepEqual(helper.dependencyEvidence, {
    incomingResolvedDependencyCount: 2,
    outgoingResolvedDependencyCount: 1,
    staticInvocationReachability: "transitive",
    minimumInvocationDependencyDepth: 1,
  });
  assert.equal(helper.invocationCount, 0);
  assert.deepEqual(helper.invocationGovernance, {
    invocationsWithEffectivePolicyEvidence: 0,
    invocationsWithoutEffectivePolicyEvidence: 0,
    distinctEffectivePolicyFingerprints: [],
  });
  const worker = surface(inventory, "tools/worker.py");
  assert.equal(worker.dependencyEvidence.minimumInvocationDependencyDepth, 2);
  const unused = surface(inventory, "tools/check-unused-env.mjs");
  assert.equal(
    unused.dependencyEvidence.staticInvocationReachability,
    "unreached",
  );
  const pythonHelper = surface(inventory, "tools/python/helper.py");
  assert.equal(
    pythonHelper.dependencyEvidence.minimumInvocationDependencyDepth,
    1,
  );
  const parser = surface(inventory, "tools/python/shared/parser.py");
  assert.equal(parser.dependencyEvidence.minimumInvocationDependencyDepth, 1);

  assert.equal(inventory.summary.invokedSurfaces, 2);
  assert.equal(inventory.summary.uninvokedSurfaces, 5);
  assert.equal(snapshot.diagnostics.length, 0);
  assert.deepEqual(snapshot.executableSurfaceInventory, inventory);

  const result = await scan(root);
  assert.deepEqual(result.executableSurfaceInventory, inventory);
  const rendered = formatText(result);
  assert.match(
    rendered,
    /Executable surfaces: 7; static reachability 2 direct, 4 transitive; invocations 2\/2 resolved; invocation-context policy evidence 2\/2/,
  );
  assert.doesNotMatch(rendered, /Executable Surface Review/);
  assert.doesNotMatch(rendered, /env-check-helpers\.mjs/);
  const jsonInventory = JSON.parse(
    formatJson(result),
  ).executableSurfaceInventory;
  assert.deepEqual(jsonInventory.dependencies, inventory.dependencies);

  const manifest = await bom(root, {}, { omitGeneratedAt: true });
  assert.deepEqual(manifest.executableSurfaceInventory, inventory);
  const markdown = formatBomMarkdown(manifest);
  assert.match(markdown, /### Executable dependencies/);
  assert.match(markdown, /env-check-helpers\.mjs/);
  assert.match(markdown, /4 transitive/);
});

test("dependency diff identity ignores line movement and reports resolution changes", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-dependency-diff-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "tools"), { recursive: true });
  await writeFile(
    path.join(root, "tools", "check.mjs"),
    'import "./helper.mjs";\n',
  );

  const before = (await collectRepositorySnapshot(root))
    .executableSurfaceInventory;
  const review = formatExecutableSurfaceInventoryText(before).join("\n");
  assert.match(review, /Review dependencies:/);
  assert.match(review, /tools\/check\.mjs:L1 js-ts static-import/);
  assert.match(review, /resolution missing/);
  await writeFile(
    path.join(root, "tools", "check.mjs"),
    '// preceding line\n\nimport "./helper.mjs";\n',
  );
  const shifted = (await collectRepositorySnapshot(root))
    .executableSurfaceInventory;
  const lineOnly = buildExecutableSurfaceDiff(before, shifted);
  assert.deepEqual(lineOnly.addedDependencies, []);
  assert.deepEqual(lineOnly.removedDependencies, []);
  assert.deepEqual(lineOnly.dependencyResolutionChanges, []);

  await writeFile(path.join(root, "tools", "helper.mjs"), "export {};\n");
  const resolved = (await collectRepositorySnapshot(root))
    .executableSurfaceInventory;
  const changed = buildExecutableSurfaceDiff(shifted, resolved);
  assert.equal(changed.dependencyResolutionChanges.length, 1);
  assert.deepEqual(
    changed.dependencyResolutionChanges.map((change) => ({
      from: change.fromResolution,
      to: change.toResolution,
    })),
    [{ from: "missing", to: "resolved" }],
  );
  assert.ok(
    changed.changedSurfaces.some(
      (change) =>
        change.path === "tools/check.mjs" &&
        change.reasons.includes("dependency-graph"),
    ),
  );

  await writeFile(path.join(root, "tools", "other.mjs"), "export {};\n");
  const bothTargets = (await collectRepositorySnapshot(root))
    .executableSurfaceInventory;
  await writeFile(
    path.join(root, "tools", "check.mjs"),
    '// preceding line\n\nimport "./other.mjs";\n',
  );
  const retargeted = (await collectRepositorySnapshot(root))
    .executableSurfaceInventory;
  const retargetedDiff = buildExecutableSurfaceDiff(bothTargets, retargeted);
  assert.equal(retargetedDiff.addedDependencies.length, 1);
  assert.equal(retargetedDiff.removedDependencies.length, 1);
  assert.ok(
    retargetedDiff.changedSurfaces.some(
      (change) =>
        change.path === "tools/check.mjs" &&
        change.reasons.includes("dependency-graph"),
    ),
  );
});

test("TypeScript surfaces participate in direct invocation and dependency reachability without TSX expansion", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-typescript-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "skills", "demo"), { recursive: true });
  await mkdir(path.join(root, "tools"), { recursive: true });
  await writeFile(
    path.join(root, "skills", "demo", "SKILL.md"),
    [
      "---",
      "name: demo",
      "description: Run TypeScript evidence. Use when static tooling needs review.",
      "---",
      "# Demo",
      "```sh",
      "node tools/check.ts",
      "```",
    ].join("\n"),
  );
  await writeFile(
    path.join(root, "tools", "check.ts"),
    'import "./helper.cts";\n',
  );
  await writeFile(path.join(root, "tools", "helper.cts"), "export {};\n");
  await writeFile(path.join(root, "tools", "ignored.tsx"), "export {};\n");

  const inventory = (await collectRepositorySnapshot(root))
    .executableSurfaceInventory;
  assert.equal(
    surface(inventory, "tools/check.ts").dependencyEvidence
      .staticInvocationReachability,
    "direct",
  );
  assert.equal(
    surface(inventory, "tools/helper.cts").dependencyEvidence
      .minimumInvocationDependencyDepth,
    1,
  );
  assert.equal(
    inventory.surfaces.some((candidate) => candidate.path.endsWith(".tsx")),
    false,
  );
});

test("minimum-depth traversal is deterministic across multiple paths and cycles", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-cycle-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "skills", "demo"), { recursive: true });
  await mkdir(path.join(root, "tools"), { recursive: true });
  await writeFile(
    path.join(root, "skills", "demo", "SKILL.md"),
    [
      "---",
      "name: demo",
      "description: Traverse dependencies. Use when cycle handling needs review.",
      "---",
      "# Demo",
      "```sh",
      "node tools/a.mjs",
      "node tools/d.mjs",
      "```",
    ].join("\n"),
  );
  await writeFile(
    path.join(root, "tools", "a.mjs"),
    'import "./b.mjs";\nimport "./c.mjs";\n',
  );
  await writeFile(
    path.join(root, "tools", "b.mjs"),
    'import "./d.mjs";\nimport "./e.mjs";\n',
  );
  await writeFile(path.join(root, "tools", "c.mjs"), 'import "./e.mjs";\n');
  await writeFile(path.join(root, "tools", "d.mjs"), 'import "./b.mjs";\n');
  await writeFile(path.join(root, "tools", "e.mjs"), 'import "./b.mjs";\n');
  await writeFile(path.join(root, "tools", "f.mjs"), 'import "./g.mjs";\n');
  await writeFile(path.join(root, "tools", "g.mjs"), "export {};\n");

  const first = (await collectRepositorySnapshot(root))
    .executableSurfaceInventory;
  const second = (await collectRepositorySnapshot(root))
    .executableSurfaceInventory;
  assert.deepEqual(first, second);
  assert.equal(
    surface(first, "tools/a.mjs").dependencyEvidence
      .minimumInvocationDependencyDepth,
    0,
  );
  assert.equal(
    surface(first, "tools/b.mjs").dependencyEvidence
      .minimumInvocationDependencyDepth,
    1,
  );
  assert.equal(
    surface(first, "tools/c.mjs").dependencyEvidence
      .minimumInvocationDependencyDepth,
    1,
  );
  assert.equal(
    surface(first, "tools/d.mjs").dependencyEvidence
      .minimumInvocationDependencyDepth,
    0,
  );
  assert.equal(
    surface(first, "tools/d.mjs").dependencyEvidence
      .staticInvocationReachability,
    "direct",
  );
  assert.equal(
    surface(first, "tools/e.mjs").dependencyEvidence
      .minimumInvocationDependencyDepth,
    2,
  );
  assert.equal(
    surface(first, "tools/g.mjs").dependencyEvidence
      .staticInvocationReachability,
    "unreached",
  );
});

test("bounded lexical false-positive forms remain candidate-free", () => {
  fc.assert(
    fc.property(
      fc.array(
        fc.constantFrom(
          '// import "./comment.js";',
          '/* import "./block.js"; */',
          'const value = "import \\"./string.js\\"";',
          'const value = `import "./template.js"`;',
          'const value = `${condition ? `import "./nested.js"` : "none"}`;',
          'import("./dynamic.js");',
          'require("./required.cjs");',
          'import value from "package-name";',
          'import type { Value } from "./types.ts";',
        ),
        { maxLength: 30 },
      ),
      (lines) => {
        assert.deepEqual(
          JS_TS_EXECUTABLE_DEPENDENCY_ANALYZER.collect({
            path: "tools/check.ts",
            content: lines.join("\n"),
          }),
          [],
        );
      },
    ),
    { numRuns: 100 },
  );
});

test("single-candidate repository states preserve the resolution partition", () => {
  fc.assert(
    fc.property(
      fc.constantFrom(
        "excluded",
        "deep",
        "oversize",
        "unsupported",
        "symlink",
        "unreadable",
        "absent",
      ),
      (state) => {
        const [dependency] = resolveExecutableDependencies(
          [pythonCandidate("tools/check.py", ".target", ["tools/target.py"])],
          new Map([["tools/target.py", state]]),
          new Map(),
        );
        assert.equal(
          dependency?.resolution,
          state === "absent" ? "missing" : state,
        );
      },
    ),
  );
});

function pythonCandidate(
  sourcePath: string,
  rawSpecifier: string,
  normalizedTargetCandidates: string[],
  unsafe = false,
  declarationOffset = 0,
) {
  return {
    analyzer: "python" as const,
    sourcePath,
    declarationOffset,
    line: 1,
    snippet: `from ${rawSpecifier} import value`,
    relation: "static-import" as const,
    rawSpecifier,
    normalizedTargetCandidates,
    unsafe,
  };
}

function surface(
  inventory: Awaited<
    ReturnType<typeof collectRepositorySnapshot>
  >["executableSurfaceInventory"],
  surfacePath: string,
) {
  const found = inventory.surfaces.find(
    (candidate) => candidate.path === surfacePath,
  );
  assert.ok(found, surfacePath);
  return found;
}

async function integrationFixture(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-dependency-"));
  await mkdir(path.join(root, "skills", "demo"), { recursive: true });
  await mkdir(path.join(root, "tools", "python", "shared"), {
    recursive: true,
  });
  await writeFile(
    path.join(root, "skills", "demo", "SKILL.md"),
    [
      "---",
      "name: demo",
      "description: Check environments. Use when repository tools need validation.",
      "metadata:",
      '  renma.network-allowed: "false"',
      "---",
      "# Demo",
      "",
      "```sh",
      "node tools/check-node-env.mjs",
      "python tools/python/check.py",
      "```",
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(root, "tools", "check-node-env.mjs"),
    'import { run } from "./env-check-helpers.mjs";\nrun();\n',
  );
  await writeFile(
    path.join(root, "tools", "check-unused-env.mjs"),
    'import { run } from "./env-check-helpers.mjs";\nrun();\n',
  );
  await writeFile(
    path.join(root, "tools", "env-check-helpers.mjs"),
    'import worker from "./worker.py";\nexport function run() { return worker; }\n',
  );
  await writeFile(path.join(root, "tools", "worker.py"), "value = 1\n");
  await writeFile(
    path.join(root, "tools", "python", "check.py"),
    "from .helper import run\nfrom .shared.parser import parse\nrun(parse)\n",
  );
  await writeFile(
    path.join(root, "tools", "python", "helper.py"),
    "def run(value):\n    return value\n",
  );
  await writeFile(
    path.join(root, "tools", "python", "shared", "parser.py"),
    "def parse():\n    return True\n",
  );
  return root;
}

function artifact(artifactPath: string, content: string): Artifact {
  return {
    path: artifactPath,
    absolutePath: `/${artifactPath}`,
    kind: artifactPath.includes("/scripts/") ? "script" : "unknown",
    sizeBytes: Buffer.byteLength(content),
    contentClassification: "text",
    markdownParserEligible: artifactPath.endsWith(".md"),
    content,
  };
}

test("candidate collection analyzes only current executable surfaces", () => {
  const artifacts = [
    artifact("tools/check.ts", 'import "./helper.ts";\n'),
    artifact("contexts/not-a-surface.ts", 'import "./helper.ts";\n'),
    artifact("skills/demo/scripts/check.py", "from . import helper\n"),
    artifact("tools/helper.ts", "export {};\n"),
  ];
  const documents = artifacts.map(parseDocument);
  assert.deepEqual(
    collectExecutableDependencyCandidates(artifacts, documents).map(
      (candidate) => candidate.sourcePath,
    ),
    ["skills/demo/scripts/check.py", "tools/check.ts"],
  );
});
