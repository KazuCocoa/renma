import assert from "node:assert/strict";
import test from "node:test";

import fc from "fast-check";

import {
  analyzeDestinations,
  networkDestinations,
  unapprovedDestinations,
  unquotedCurlNextSpans,
  unquotedShellSeparatorSpans,
  uploadDestinations,
  type DestinationAnalysis,
  type SourceSpan,
} from "../src/security-destination/index.js";
import { securityDiagnosticFindings } from "../src/security-diagnostics.js";
import type { Artifact } from "../src/types.js";

const PROPERTY_SEED = 0x224119;
const PROPERTY_RUNS = 80;
const PROPERTY_PARAMETERS = { seed: PROPERTY_SEED, numRuns: PROPERTY_RUNS };
const LETTERS = [..."abcdefghijklmnopqrstuvwxyz"] as [string, ...string[]];
const labelArbitrary = fc
  .array(fc.constantFrom(...LETTERS), { minLength: 1, maxLength: 12 })
  .map((characters) => characters.join(""));
const pathArbitrary = fc
  .array(fc.constantFrom(...LETTERS), { minLength: 1, maxLength: 16 })
  .map((characters) => characters.join(""));

function semanticAnalysis(analysis: DestinationAnalysis) {
  return {
    projection: analysis.projection,
    candidates: analysis.candidates,
    operationalDestinations: analysis.operationalDestinations.map(
      ({
        intent,
        candidateKind,
        actionKind,
        tool,
        destination,
        evaluation,
      }) => ({
        intent,
        candidateKind,
        actionKind,
        tool,
        destination,
        evaluation,
      }),
    ),
  };
}

function contextArtifact(content: string): Artifact {
  return {
    path: "contexts/security/property.md",
    absolutePath: "/repo/contexts/security/property.md",
    kind: "context",
    sizeBytes: Buffer.byteLength(content),
    contentClassification: "text",
    markdownParserEligible: true,
    content,
  };
}

test("destination analysis and finding generation are deterministic", () => {
  fc.assert(
    fc.property(labelArbitrary, pathArbitrary, (label, path) => {
      const input = `curl --data @payload.json https://${label}.example.com/${path}`;
      assert.deepEqual(analyzeDestinations(input), analyzeDestinations(input));

      const artifact = contextArtifact(`---
allowed_data: public
network_allowed: true
approved_network_destinations: approved.example.com
external_upload_allowed: true
approved_upload_destinations: approved.example.com
---

${input}
`);
      assert.deepEqual(
        securityDiagnosticFindings([artifact]),
        securityDiagnosticFindings([artifact]),
      );
    }),
    PROPERTY_PARAMETERS,
  );
});

test("active backslash-newlines preserve supported curl semantics", () => {
  fc.assert(
    fc.property(labelArbitrary, pathArbitrary, (label, path) => {
      const url = `https://${label}.example.com/${path}`;
      const variants: Array<[string, string]> = [
        [
          `curl --data @payload.json \\\n${url}`,
          `curl --data @payload.json ${url}`,
        ],
        [
          `curl --data-bin\\\nary @payload.json ${url}`,
          `curl --data-binary @payload.json ${url}`,
        ],
        [`curl -X PO\\\nST ${url}`, `curl -X POST ${url}`],
        [
          `curl --data @payload.json https://${label}.exam\\\nple.com/${path}`,
          `curl --data @payload.json ${url}`,
        ],
        [
          `curl --data @payload.json https://${label}.example.com/${path.slice(0, 1)}\\\n${path.slice(1)}`,
          `curl --data @payload.json ${url}`,
        ],
        [
          `curl --data @payload.json "https://${label}.example.com/${path.slice(0, 1)}\\\n${path.slice(1)}"`,
          `curl --data @payload.json "${url}"`,
        ],
      ];

      for (const [continued, joined] of variants) {
        assert.deepEqual(
          semanticAnalysis(analyzeDestinations(continued)),
          semanticAnalysis(analyzeDestinations(joined)),
          continued,
        );
      }
    }),
    PROPERTY_PARAMETERS,
  );
});

const CURL_UPLOAD_OPTIONS = [
  "-d @payload.json",
  "--data @payload.json",
  "--data-binary @payload.json",
  "-F file=@payload.json",
  "--form file=@payload.json",
  "-T payload.json",
  "--upload-file payload.json",
  "-X POST",
  "-X PUT",
] as const;

test("curl upload association is invariant to supported option order", () => {
  fc.assert(
    fc.property(
      fc.constantFrom(...CURL_UPLOAD_OPTIONS),
      labelArbitrary,
      pathArbitrary,
      (option, label, path) => {
        const url = `https://${label}.example.com/${path}`;
        const before = uploadDestinations(
          analyzeDestinations(`curl ${option} ${url}`),
        );
        const after = uploadDestinations(
          analyzeDestinations(`curl ${url} ${option}`),
        );
        assert.deepEqual(before, after);
        assert.equal(before.length, 1);
      },
    ),
    PROPERTY_PARAMETERS,
  );
});

test("candidate words cannot create their own action", () => {
  fc.assert(
    fc.property(
      fc.constantFrom("upload", "publish", "post", "get", "send", "sync"),
      labelArbitrary,
      (actionWord, label) => {
        for (const input of [
          `Document ${actionWord}.${label}.example.com as a label.`,
          `Validate ${actionWord}-${label}.json locally.`,
        ]) {
          const analysis = analyzeDestinations(input);
          assert.deepEqual(networkDestinations(analysis), []);
          assert.deepEqual(uploadDestinations(analysis), []);
        }
      },
    ),
    PROPERTY_PARAMETERS,
  );
});

const SHELL_BOUNDARIES = ["&&", "||", "|", ";", "&", "--next"] as const;
const escapedBoundary = (
  boundary: (typeof SHELL_BOUNDARIES)[number],
): string =>
  boundary === "--next"
    ? "\\--next"
    : [...boundary].map((character) => `\\${character}`).join("");

test("quote and escape state controls shell and curl transfer boundaries", () => {
  fc.assert(
    fc.property(
      fc.constantFrom(...SHELL_BOUNDARIES),
      labelArbitrary,
      (boundary, label) => {
        const scanBoundaries = (input: string) =>
          boundary === "--next"
            ? unquotedCurlNextSpans(input, { start: 0, end: input.length })
            : unquotedShellSeparatorSpans(input, {
                start: 0,
                end: input.length,
              });
        for (const protectedBoundary of [
          `"${boundary}"`,
          `'${boundary}'`,
          escapedBoundary(boundary),
        ]) {
          const input = `curl ${label} ${protectedBoundary} tail`;
          assert.deepEqual(scanBoundaries(input), [], protectedBoundary);
        }

        const unquoted = `curl ${label} ${boundary} tail`;
        assert.equal(scanBoundaries(unquoted).length, 1, boundary);
      },
    ),
    PROPERTY_PARAMETERS,
  );

  for (const redirection of ["&>", "2>&1"] as const) {
    assert.equal(
      uploadDestinations(
        analyzeDestinations(
          `curl https://sink.example.com/upload ${redirection} output.log --data @payload.json`,
        ),
      ).length,
      1,
    );
  }
});

test("coordinated lists preserve sets and deduplicate destinations", () => {
  fc.assert(
    fc.property(
      fc.uniqueArray(labelArbitrary, { minLength: 2, maxLength: 5 }),
      (labels) => {
        const hosts = labels.map((label) => `${label}.example.com`);
        const forward = uploadDestinations(
          analyzeDestinations(`Upload to ${hosts.join(", ")}.`),
        );
        const reversed = uploadDestinations(
          analyzeDestinations(`Upload to ${[...hosts].reverse().join(", ")}.`),
        );
        assert.deepEqual(
          new Set(forward.map(({ host }) => host)),
          new Set(reversed.map(({ host }) => host)),
        );

        const duplicate = uploadDestinations(
          analyzeDestinations(
            `Upload to ${hosts[0]}, ${hosts[0]}, ${hosts[1]}.`,
          ),
        );
        assert.equal(
          new Set(duplicate.map(({ host }) => host)).size,
          duplicate.length,
        );
      },
    ),
    PROPERTY_PARAMETERS,
  );
});

test("allowlist matching is monotonic and retains exact boundaries", () => {
  fc.assert(
    fc.property(labelArbitrary, pathArbitrary, (label, path) => {
      const required = networkDestinations(
        analyzeDestinations(`Fetch https://${label}.example.com/${path}/item.`),
      );
      const baseline = unapprovedDestinations(required, ["other.example.com"]);
      const unrelated = unapprovedDestinations(required, [
        "other.example.com",
        "unrelated.example.net",
      ]);
      const approved = unapprovedDestinations(required, [
        "other.example.com",
        `https://${label}.example.com/${path}`,
      ]);
      assert.deepEqual(unrelated, baseline);
      assert.ok(approved.length <= baseline.length);
      assert.deepEqual(approved, []);

      assert.equal(
        unapprovedDestinations(required, [
          `https://${label}.example.com/${path}-sibling`,
        ]).length,
        1,
      );
    }),
    PROPERTY_PARAMETERS,
  );

  const ipv4 = networkDestinations(
    analyzeDestinations("Fetch http://10.0.0.20/data."),
  );
  assert.equal(unapprovedDestinations(ipv4, ["10.0.0.2"]).length, 1);
  const singleLabel = networkDestinations(
    analyzeDestinations("Fetch http://artifact-server/data."),
  );
  assert.equal(
    unapprovedDestinations(singleLabel, ["http://server"]).length,
    1,
  );
});

test("upload allowlist changes cannot change network analysis or findings", () => {
  fc.assert(
    fc.property(labelArbitrary, labelArbitrary, (source, sink) => {
      fc.pre(source !== sink);
      const instruction = `Fetch from ${source}.example.com and upload to ${sink}.example.com.`;
      const analysis = analyzeDestinations(instruction);
      assert.deepEqual(
        networkDestinations(analysis).map(({ host }) => host),
        [`${source}.example.com`, `${sink}.example.com`],
      );
      assert.deepEqual(
        uploadDestinations(analysis).map(({ host }) => host),
        [`${sink}.example.com`],
      );

      const findingsFor = (approvedUploadDestination: string) =>
        securityDiagnosticFindings([
          contextArtifact(`---
allowed_data: public
network_allowed: true
approved_network_destinations: ${source}.example.com
external_upload_allowed: true
approved_upload_destinations: ${approvedUploadDestination}
---

${instruction}
`),
        ]);
      const approvedUpload = findingsFor(`${sink}.example.com`);
      const unapprovedUpload = findingsFor("unrelated.example.net");
      const networkFindings = (findings: typeof approvedUpload) =>
        findings.filter(
          ({ id }) => id === "SEC-UNAPPROVED-NETWORK-DESTINATION",
        );
      const findingsUnaffectedByUploadPolicy = (
        findings: typeof approvedUpload,
      ) =>
        findings.filter(({ id }) => id !== "SEC-UNAPPROVED-UPLOAD-DESTINATION");

      assert.deepEqual(
        networkFindings(approvedUpload),
        networkFindings(unapprovedUpload),
      );
      assert.equal(networkFindings(approvedUpload).length, 1);
      assert.deepEqual(
        findingsUnaffectedByUploadPolicy(approvedUpload),
        findingsUnaffectedByUploadPolicy(unapprovedUpload),
      );
      assert.equal(
        approvedUpload.filter(
          ({ id }) => id === "SEC-UNAPPROVED-UPLOAD-DESTINATION",
        ).length,
        0,
      );
      assert.equal(
        unapprovedUpload.filter(
          ({ id }) => id === "SEC-UNAPPROVED-UPLOAD-DESTINATION",
        ).length,
        1,
      );
    }),
    PROPERTY_PARAMETERS,
  );
});

function assertValidSpan(
  span: SourceSpan,
  input: string,
  sourceBaseLine = 1,
): void {
  assert.ok(span.startOffset >= 0);
  assert.ok(span.endOffset <= input.length);
  assert.ok(span.startOffset < span.endOffset);
  const lineCount = input.split("\n").length;
  if (span.startLine !== undefined) {
    assert.ok(
      span.startLine >= sourceBaseLine &&
        span.startLine < sourceBaseLine + lineCount,
    );
  }
  if (span.endLine !== undefined) {
    assert.ok(
      span.endLine >= sourceBaseLine &&
        span.endLine < sourceBaseLine + lineCount,
    );
  }
  assert.equal(
    span.startLine,
    sourceBaseLine + input.slice(0, span.startOffset).split("\n").length - 1,
  );
  assert.equal(
    span.endLine,
    sourceBaseLine + input.slice(0, span.endOffset - 1).split("\n").length - 1,
  );
}

function assertContains(outer: SourceSpan, inner: SourceSpan): void {
  assert.ok(outer.startOffset <= inner.startOffset);
  assert.ok(outer.endOffset >= inner.endOffset);
}

test("standalone IR spans preserve continued source evidence and containment", () => {
  fc.assert(
    fc.property(labelArbitrary, pathArbitrary, (label, path) => {
      const input = [
        `curl https://${label}.exam\\`,
        `ple.com/${path} \\`,
        "  --data-binary @payload.json",
      ].join("\n");
      const analysis = analyzeDestinations(input);
      assert.equal(analysis.input, input);
      assert.equal(analysis.sourceBaseLine, 1);
      assert.deepEqual(analysis, analyzeDestinations(input));

      const evaluated = analysis.operationalDestinations.filter(
        ({ evaluation }) => evaluation.kind === "evaluated",
      );
      assert.equal(evaluated.length, 2);
      for (const operational of evaluated) {
        assertValidSpan(operational.candidateSpan, input);
        const candidateSource = input.slice(
          operational.candidateSpan.startOffset,
          operational.candidateSpan.endOffset,
        );
        assert.match(candidateSource, /\\\n/u);
        assert.equal(
          candidateSource.replaceAll("\\\n", ""),
          operational.destination?.raw,
        );
        if (operational.commandSpan !== undefined) {
          assertValidSpan(operational.commandSpan, input);
          assertContains(operational.commandSpan, operational.candidateSpan);
          assert.equal(operational.commandSpan.startLine, 1);
          assert.equal(operational.commandSpan.endLine, 3);
          assert.equal(
            input.slice(
              operational.commandSpan.startOffset,
              operational.commandSpan.endOffset,
            ),
            input,
          );
        }
        if (operational.transferSpan !== undefined) {
          assertValidSpan(operational.transferSpan, input);
          assertContains(operational.transferSpan, operational.candidateSpan);
          assert.equal(operational.transferSpan.startLine, 1);
          assert.equal(operational.transferSpan.endLine, 3);
          assert.ok(operational.commandSpan);
          assertContains(operational.commandSpan, operational.transferSpan);
        }
      }
    }),
    PROPERTY_PARAMETERS,
  );
});

test("bounded arbitrary strings never throw or mutate input", () => {
  fc.assert(
    fc.property(fc.string({ maxLength: 256 }), (input) => {
      const original = input;
      const first = analyzeDestinations(input);
      const second = analyzeDestinations(input);
      assert.equal(input, original);
      assert.deepEqual(first, second);
      assert.ok(first.candidates.length <= input.length + 1);
      assert.ok(
        first.operationalDestinations.length <= first.candidates.length * 2,
      );
    }),
    PROPERTY_PARAMETERS,
  );
});
