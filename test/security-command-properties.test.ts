import assert from "node:assert/strict";
import test from "node:test";

import fc from "fast-check";

import { MarkdownSecurityView } from "../src/markdown-security-view.js";
import { parseMarkdownSyntax } from "../src/markdown-syntax.js";
import { analyzeSecurityCommand } from "../src/security-command/index.js";

const PROPERTY_PARAMETERS = { seed: 0x240098, numRuns: 80 };
const LETTERS = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"] as [string, ...string[]];
const variableArbitrary = fc
  .array(fc.constantFrom(...LETTERS), { minLength: 2, maxLength: 12 })
  .map((characters) => `${characters.join("")}_VERSION`);

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
            kind: "preceding-paragraph" as const,
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
              kind: "preceding-paragraph",
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
            kind: "preceding-paragraph",
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

test("disclosure sinks cannot be neutralized and fallback stays fail-closed", () => {
  fc.assert(
    fc.property(variableArbitrary, (variableName) => {
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
    }),
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
