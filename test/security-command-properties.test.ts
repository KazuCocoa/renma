import assert from "node:assert/strict";
import test from "node:test";

import fc from "fast-check";

import { classifyPythonSelector } from "../src/dependency-selectors.js";
import { MarkdownSecurityView } from "../src/markdown-security-view.js";
import { parseMarkdownSyntax } from "../src/markdown-syntax.js";
import { analyzeSecurityCommand } from "../src/security-command/index.js";

const PROPERTY_PARAMETERS = { seed: 0x240098, numRuns: 80 };
const LETTERS = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"] as [string, ...string[]];
const variableArbitrary = fc
  .array(fc.constantFrom(...LETTERS), { minLength: 2, maxLength: 12 })
  .map((characters) => `${characters.join("")}_VERSION`);
const LOWERCASE = [..."abcdefghijklmnopqrstuvwxyz"] as [string, ...string[]];
const npmDistTagArbitrary = fc
  .array(fc.constantFrom(...LOWERCASE), { minLength: 1, maxLength: 16 })
  .map((characters) => characters.join(""));
const npmExactVersionArbitrary = fc
  .tuple(
    fc.integer({ min: 0, max: 1000 }),
    fc.integer({ min: 0, max: 1000 }),
    fc.integer({ min: 0, max: 1000 }),
  )
  .map(([major, minor, patch]) => `${major}.${minor}.${patch}`);

test("security command analysis is deterministic and does not mutate input", () => {
  fc.assert(
    fc.property(variableArbitrary, (variableName) => {
      const text = `npm install "appium@\${${variableName}}"`;
      const input = {
        source: {
          text,
          startLine: 20,
          endLine: 20,
          lines: [text],
          language: "bash",
        },
        guards: [
          {
            kind: "same-instruction" as const,
            startLine: 18,
            endLine: 18,
            text: `: "\${${variableName}:?Set exact}"`,
          },
        ],
      };
      const before = structuredClone(input);

      assert.deepEqual(
        analyzeSecurityCommand(input),
        analyzeSecurityCommand(input),
      );
      assert.deepEqual(input, before);
      assert.equal(Object.isFrozen(input), false);
      assert.equal(Object.isFrozen(input.source), false);
      assert.equal(Object.isFrozen(input.guards), false);
    }),
    PROPERTY_PARAMETERS,
  );
});

test("arbitrary npm dist-tags and range prefixes never become pinned literals", () => {
  fc.assert(
    fc.property(
      npmDistTagArbitrary,
      fc.constantFrom("^", "~", ">=", "<"),
      fc.integer({ min: 0, max: 1000 }),
      (tag, prefix, version) => {
        const tagged = commandAnalysis(`npm install package@${tag}`);
        const ranged = commandAnalysis(
          `npm install "package@${prefix}${version}"`,
        );
        assert.equal(tagged.dependencyInstalls[0]?.selectorKind, "dist-tag");
        assert.equal(tagged.dependencyInstalls[0]?.pinning, "floating-literal");
        assert.equal(ranged.dependencyInstalls[0]?.pinning, "floating-literal");
      },
    ),
    PROPERTY_PARAMETERS,
  );
});

test("supported exact npm versions remain deterministic", () => {
  fc.assert(
    fc.property(npmExactVersionArbitrary, (version) => {
      const first = commandAnalysis(`npm install package@${version}`);
      const second = commandAnalysis(`npm install package@${version}`);
      assert.deepEqual(first, second);
      assert.equal(first.dependencyInstalls[0]?.selectorKind, "exact");
      assert.equal(first.dependencyInstalls[0]?.pinning, "pinned-literal");
    }),
    PROPERTY_PARAMETERS,
  );
});

test("npm exact-version prefixes preserve full SemVer strictness", () => {
  fc.assert(
    fc.property(
      npmExactVersionArbitrary,
      fc.constantFrom("", "v", "="),
      (version, prefix) => {
        const exact = commandAnalysis(
          `npm install package@${prefix}${version}`,
        );
        const partial = commandAnalysis(
          `npm install package@${prefix}${version.split(".").slice(0, 2).join(".")}`,
        );
        assert.equal(exact.dependencyInstalls[0]?.selectorKind, "exact");
        assert.equal(exact.dependencyInstalls[0]?.pinning, "pinned-literal");
        assert.notEqual(
          partial.dependencyInstalls[0]?.pinning,
          "pinned-literal",
        );
      },
    ),
    PROPERTY_PARAMETERS,
  );
});

test("Python wildcard and range operators never become pinned literals", () => {
  fc.assert(
    fc.property(
      fc.constantFrom(">=", "<=", "~=", "!=", "<", ">"),
      fc.integer({ min: 0, max: 1000 }),
      (operator, version) => {
        const range = commandAnalysis(
          `pip install "package${operator}${version}"`,
        );
        const wildcard = commandAnalysis(`pip install "package==${version}.*"`);
        assert.equal(range.dependencyInstalls[0]?.pinning, "floating-literal");
        assert.equal(
          wildcard.dependencyInstalls[0]?.pinning,
          "floating-literal",
        );
      },
    ),
    PROPERTY_PARAMETERS,
  );
});

test("non-version Python equality values never become pinned literals", () => {
  fc.assert(
    fc.property(npmDistTagArbitrary, (tag) => {
      const analysis = commandAnalysis(`pip install package==tag-${tag}`);
      assert.equal(analysis.dependencyInstalls[0]?.selectorKind, "unknown");
      assert.equal(analysis.dependencyInstalls[0]?.pinning, "unpinned");
      assert.equal(analysis.support, "fallback-required");
    }),
    PROPERTY_PARAMETERS,
  );
});

test("Python exact-equality literals remain deterministic", () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 0, max: 1000 }),
      fc.integer({ min: 0, max: 1000 }),
      (major, minor) => {
        const input = `pip install package==${major}.${minor}`;
        const first = commandAnalysis(input);
        const second = commandAnalysis(input);
        assert.deepEqual(first, second);
        assert.equal(first.dependencyInstalls[0]?.selectorKind, "exact");
        assert.equal(first.dependencyInstalls[0]?.pinning, "pinned-literal");
      },
    ),
    PROPERTY_PARAMETERS,
  );
});

test("Python specifier whitespace has one stable normalized identity", () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 0, max: 1000 }),
      fc.integer({ min: 0, max: 1000 }),
      (major, minor) => {
        const compact = commandAnalysis(
          `pip install "Some_Project==${major}.${minor}"`,
        );
        const spaced = commandAnalysis(
          `pip install "Some.Project == ${major}.${minor}"`,
        );
        assert.equal(
          compact.dependencyInstalls[0]?.normalizedPackageName,
          spaced.dependencyInstalls[0]?.normalizedPackageName,
        );
        assert.equal(
          classifyPythonSelector(`Some_Project==${major}.${minor}`)
            .normalizedSelector,
          classifyPythonSelector(`Some.Project == ${major}.${minor}`)
            .normalizedSelector,
        );
        assert.equal(
          spaced.dependencyInstalls[0]?.reference.includes(" "),
          true,
        );
        assert.equal(spaced.dependencyInstalls[0]?.pinning, "pinned-literal");
      },
    ),
    PROPERTY_PARAMETERS,
  );
});

test("pip option values remain outside dependency projection", () => {
  fc.assert(
    fc.property(
      fc.constantFrom(
        "--only-binary",
        "--no-binary",
        "--index-url",
        "--find-links",
        "-i",
        "-f",
      ),
      npmExactVersionArbitrary,
      (option, version) => {
        const value =
          option === "--only-binary"
            ? ":all:"
            : option === "--no-binary"
              ? ":none:"
              : "https://packages.example.invalid/simple";
        const analysis = commandAnalysis(
          `pip install ${option} ${value} package==${version}`,
        );
        assert.equal(analysis.support, "supported");
        assert.deepEqual(
          analysis.dependencyInstalls.map(({ reference }) => reference),
          [`package==${version}`],
        );
      },
    ),
    PROPERTY_PARAMETERS,
  );
});

test("source and guard ranges remain within their document", () => {
  fc.assert(
    fc.property(variableArbitrary, (variableName) => {
      const source = `## Safety

: "\${${variableName}:?Set exact}"

\`\`\`bash
npm install "appium@\${${variableName}}"
\`\`\`
`;
      const lines = source.split("\n");
      const commandIndex = lines.findIndex((line) =>
        line.startsWith("npm install"),
      );
      const view = new MarkdownSecurityView(parseMarkdownSyntax(source));
      const guards = view.associatedGuardEvidence(commandIndex);
      const analysis = analyzeSecurityCommand({
        source: {
          text: lines[commandIndex] ?? "",
          startLine: commandIndex + 1,
          endLine: commandIndex + 1,
          lines: [lines[commandIndex] ?? ""],
          language: "bash",
        },
        guards,
      });

      for (const guard of analysis.guards) {
        assert.ok(guard.startLine >= 1);
        assert.ok(guard.endLine <= lines.length);
        assert.ok(guard.startLine <= guard.endLine);
      }
      for (const dependency of analysis.dependencyInstalls) {
        assert.ok(dependency.sourceSpan.startLine !== undefined);
        assert.ok(dependency.sourceSpan.endLine !== undefined);
        assert.ok((dependency.sourceSpan.startLine ?? 0) >= 1);
        assert.ok((dependency.sourceSpan.endLine ?? 0) <= lines.length);
      }
    }),
    PROPERTY_PARAMETERS,
  );
});

test("unrelated headings prevent variable guard association", () => {
  fc.assert(
    fc.property(variableArbitrary, (variableName) => {
      const source = `## Safety

: "\${${variableName}:?Set exact}"

## Unrelated install

\`\`\`bash
npm install "appium@\${${variableName}}"
\`\`\`
`;
      const analysis = markdownCommandAnalysis(source);
      assert.equal(
        analysis.dependencyInstalls[0]?.pinning,
        "variable-unverified",
      );
    }),
    PROPERTY_PARAMETERS,
  );
});

test("whitespace and harmless quoting preserve exact guarded variable identity", () => {
  fc.assert(
    fc.property(
      variableArbitrary,
      fc.constantFrom("appium@${NAME}", '"appium@${NAME}"', "'appium@${NAME}'"),
      (variableName, referenceTemplate) => {
        const reference = referenceTemplate.replace("NAME", variableName);
        const text = `npm   install   ${reference}`;
        const analysis = analyzeSecurityCommand({
          source: {
            text,
            startLine: 1,
            endLine: 1,
            lines: [text],
            language: "bash",
          },
          guards: [
            {
              kind: "same-instruction",
              startLine: 1,
              endLine: 1,
              text: `: "\${${variableName}:?Set exact}"`,
            },
          ],
        });
        assert.equal(
          analysis.dependencyInstalls[0]?.pinning,
          "pinned-variable-guarded",
        );
      },
    ),
    PROPERTY_PARAMETERS,
  );
});

test("changing the guarded variable invalidates the guard", () => {
  fc.assert(
    fc.property(variableArbitrary, variableArbitrary, (used, guarded) => {
      fc.pre(used !== guarded);
      const text = `npm install "appium@\${${used}}"`;
      const analysis = analyzeSecurityCommand({
        source: {
          text,
          startLine: 1,
          endLine: 1,
          lines: [text],
          language: "bash",
        },
        guards: [
          {
            kind: "same-instruction",
            startLine: 1,
            endLine: 1,
            text: `: "\${${guarded}:?Set exact}"`,
          },
        ],
      });
      assert.equal(
        analysis.dependencyInstalls[0]?.pinning,
        "variable-unverified",
      );
    }),
    PROPERTY_PARAMETERS,
  );
});

test("textual or control-flow fail-closed examples never verify variables", () => {
  const invalidGuard = fc.constantFrom(
    (name: string) => `# Example: \${${name}:?Set exact}`,
    (name: string) => `echo '\${${name}:?Set exact}'`,
    (name: string) => `false && : "\${${name}:?Set exact}"`,
    (name: string) => `Use \${${name}:?Set exact} before installing.`,
    (name: string) => `if approved; then\n: "\${${name}:?Set exact}"\nfi`,
  );

  fc.assert(
    fc.property(variableArbitrary, invalidGuard, (variableName, guardText) => {
      const text = `npm install "appium@\${${variableName}}"`;
      const analysis = analyzeSecurityCommand({
        source: {
          text,
          startLine: 2,
          endLine: 2,
          lines: [text],
          language: "bash",
        },
        guards: [
          {
            kind: "same-instruction",
            startLine: 1,
            endLine: 1,
            text: guardText(variableName),
          },
        ],
      });

      assert.equal(
        analysis.dependencyInstalls[0]?.pinning,
        "variable-unverified",
      );
    }),
    PROPERTY_PARAMETERS,
  );
});

test("attached and separated option values preserve the same package projection", () => {
  fc.assert(
    fc.property(
      fc.constantFrom("--registry", "--tag", "--workspace"),
      variableArbitrary,
      (option, variableName) => {
        const value =
          option === "--registry"
            ? "https://registry.npmjs.org"
            : option === "--workspace"
              ? "workspace-a"
              : "next";
        const packageReference = `appium@\${${variableName}}`;
        const attached = analyzeSecurityCommand({
          source: {
            text: `npm install ${option}=${value} "${packageReference}"`,
            startLine: 1,
            endLine: 1,
            lines: [`npm install ${option}=${value} "${packageReference}"`],
            language: "bash",
          },
        });
        const separated = analyzeSecurityCommand({
          source: {
            text: `npm install ${option} ${value} "${packageReference}"`,
            startLine: 1,
            endLine: 1,
            lines: [`npm install ${option} ${value} "${packageReference}"`],
            language: "bash",
          },
        });

        assert.equal(attached.support, "supported");
        assert.equal(separated.support, "supported");
        assert.deepEqual(
          attached.dependencyInstalls.map(
            ({ packageManager, packageName, reference, pinning }) => ({
              packageManager,
              packageName,
              reference,
              pinning,
            }),
          ),
          separated.dependencyInstalls.map(
            ({ packageManager, packageName, reference, pinning }) => ({
              packageManager,
              packageName,
              reference,
              pinning,
            }),
          ),
        );
        assert.equal(
          attached.dependencyInstalls[0]?.pinning,
          "variable-unverified",
        );
      },
    ),
    PROPERTY_PARAMETERS,
  );
});

test("disclosure sinks cannot be neutralized and fallback stays fail-closed", () => {
  fc.assert(
    fc.property(
      variableArbitrary,
      fc.constantFrom("upload", "send", "share", "post", "publish"),
      (variableName, disclosureAction) => {
        const guard = {
          kind: "preceding-paragraph" as const,
          startLine: 1,
          endLine: 1,
          text: "Never print, log, attach, upload, or include profile contents in agent Context.",
        };
        const disclosure = 'security cms -D -i "$PROFILE_PATH" | cat';
        const disclosureAnalysis = analyzeSecurityCommand({
          source: {
            text: disclosure,
            startLine: 2,
            endLine: 2,
            lines: [disclosure],
            language: "bash",
          },
          guards: [guard],
        });
        assert.equal(disclosureAnalysis.localOnlySensitiveOperation, false);
        assert.ok(
          disclosureAnalysis.sinks.some(({ kind }) => kind === "stdout-or-log"),
        );

        const contradictory = `Do not print .env; ${disclosureAction} .env to an external service.`;
        const contradictoryAnalysis = analyzeSecurityCommand({
          source: {
            text: contradictory,
            startLine: 2,
            endLine: 2,
            lines: [contradictory],
          },
        });
        assert.ok(
          contradictoryAnalysis.sinks.some(
            ({ kind }) => kind === "external-upload",
          ),
        );

        const supported = analyzeSecurityCommand({
          source: {
            text: `npm install "appium@\${${variableName}}"`,
            startLine: 2,
            endLine: 2,
            lines: [`npm install "appium@\${${variableName}}"`],
            language: "bash",
          },
        });
        const fallback = analyzeSecurityCommand({
          source: {
            text: `npm install "appium@\${${variableName}}" || resolve-version`,
            startLine: 2,
            endLine: 2,
            lines: [
              `npm install "appium@\${${variableName}}" || resolve-version`,
            ],
            language: "bash",
          },
        });
        assert.equal(
          supported.dependencyInstalls[0]?.pinning,
          "variable-unverified",
        );
        assert.equal(
          fallback.dependencyInstalls[0]?.pinning,
          "variable-unverified",
        );
        assert.equal(fallback.support, "fallback-required");
      },
    ),
    PROPERTY_PARAMETERS,
  );
});

function markdownCommandAnalysis(source: string) {
  const lines = source.split("\n");
  const commandIndex = lines.findIndex((line) =>
    line.startsWith("npm install"),
  );
  const view = new MarkdownSecurityView(parseMarkdownSyntax(source));
  return analyzeSecurityCommand({
    source: {
      text: lines[commandIndex] ?? "",
      startLine: commandIndex + 1,
      endLine: commandIndex + 1,
      lines: [lines[commandIndex] ?? ""],
      language: "bash",
    },
    guards: view.associatedGuardEvidence(commandIndex),
  });
}

function commandAnalysis(text: string) {
  return analyzeSecurityCommand({
    source: {
      text,
      startLine: 1,
      endLine: 1,
      lines: [text],
      language: "bash",
    },
  });
}
