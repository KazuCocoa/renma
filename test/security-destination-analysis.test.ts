import assert from "node:assert/strict";
import test from "node:test";

import {
  associatedNetworkDestinations,
  associatedUploadDestinations,
  classifyDestinationCandidates,
} from "../src/security-diagnostics.js";
import {
  analyzeDestinations,
  networkDestinations,
  unapprovedDestinations,
  uploadDestinations,
} from "../src/security-destination/index.js";
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
