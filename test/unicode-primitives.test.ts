import assert from "node:assert/strict";
import test from "node:test";

import { DIAGNOSTIC_IDS } from "../src/diagnostic-ids.js";
import { hiddenUnicodeFindings } from "../src/hidden-unicode.js";
import { reviewedDefaultIgnorableProjection } from "../src/security-identifier-integrity.js";
import type { Artifact } from "../src/types/artifact.js";
import {
  DELETE_AND_C1_CONTROL_RANGE,
  formatCodePoint,
  isCodePointInRange,
  isCodePointInRanges,
  TAG_BLOCK_RANGE,
  UNICODE_CODE_POINTS,
  VARIATION_SELECTOR_RANGES,
} from "../src/unicode-primitives.js";

const INVISIBLE_ID = DIAGNOSTIC_IDS.SEC_SUSPICIOUS_INVISIBLE_CHARACTER;

test("shared control and tag ranges retain inclusive boundaries", () => {
  for (const codePoint of [0x007f, 0x009f]) {
    assert.equal(
      isCodePointInRange(codePoint, DELETE_AND_C1_CONTROL_RANGE),
      true,
    );
    assert.equal(
      reviewedDefaultIgnorableProjection(`a${String.fromCodePoint(codePoint)}b`)
        .sanitized,
      "ab",
    );
    assert.equal(
      hiddenFindingCodePoints(String.fromCodePoint(codePoint))[0],
      formatCodePoint(codePoint),
    );
  }
  assert.equal(isCodePointInRange(0x007e, DELETE_AND_C1_CONTROL_RANGE), false);
  assert.equal(isCodePointInRange(0x00a0, DELETE_AND_C1_CONTROL_RANGE), false);

  assert.equal(isCodePointInRange(0xdffff, TAG_BLOCK_RANGE), false);
  assert.equal(isCodePointInRange(0xe0000, TAG_BLOCK_RANGE), true);
  assert.equal(isCodePointInRange(0xe007f, TAG_BLOCK_RANGE), true);
  assert.equal(isCodePointInRange(0xe0080, TAG_BLOCK_RANGE), false);
});

test("security projection stays broader than high-signal hidden-Unicode detection", () => {
  for (const codePoint of [0x061c, 0x200e, 0x200f]) {
    const character = String.fromCodePoint(codePoint);
    assert.deepEqual(hiddenUnicodeFindings(artifact(`a${character}b`)), []);
    assert.deepEqual(reviewedDefaultIgnorableProjection(`a${character}b`), {
      sanitized: "ab",
      removedCodePoints: [formatCodePoint(codePoint)],
    });
  }

  const bom = String.fromCodePoint(UNICODE_CODE_POINTS.BYTE_ORDER_MARK);
  assert.deepEqual(hiddenUnicodeFindings(artifact(`${bom}heading`)), []);
  assert.deepEqual(reviewedDefaultIgnorableProjection(`${bom}heading`), {
    sanitized: "heading",
    removedCodePoints: ["U+FEFF"],
  });
  assert.deepEqual(hiddenFindingCodePoints(`a${bom}b`), ["U+FEFF"]);
});

test("BMP and supplementary variation-selector boundaries share data but not policy", () => {
  const boundaries = [0xfe00, 0xfe0f, 0xe0100, 0xe01ef];
  for (const codePoint of boundaries) {
    assert.equal(
      isCodePointInRanges(codePoint, VARIATION_SELECTOR_RANGES),
      true,
    );
    const selector = String.fromCodePoint(codePoint);
    assert.deepEqual(hiddenUnicodeFindings(artifact(`字${selector}`)), []);
    assert.deepEqual(reviewedDefaultIgnorableProjection(`a${selector}b`), {
      sanitized: "ab",
      removedCodePoints: [formatCodePoint(codePoint)],
    });
    assert.deepEqual(hiddenFindingCodePoints(`字${selector}${selector}`), [
      formatCodePoint(codePoint),
    ]);
  }
  assert.equal(isCodePointInRanges(0xfdff, VARIATION_SELECTOR_RANGES), false);
  assert.equal(isCodePointInRanges(0xe01f0, VARIATION_SELECTOR_RANGES), false);
});

test("tag-block scanning and reviewed identifier projection keep distinct membership", () => {
  for (const codePoint of [0xe0000, 0xe0001, 0xe0020, 0xe007f]) {
    const character = String.fromCodePoint(codePoint);
    assert.deepEqual(hiddenFindingCodePoints(character), [
      formatCodePoint(codePoint),
    ]);
    assert.deepEqual(reviewedDefaultIgnorableProjection(`a${character}b`), {
      sanitized: "ab",
      removedCodePoints: [formatCodePoint(codePoint)],
    });
  }

  for (const codePoint of [0xe0002, 0xe001f]) {
    const character = String.fromCodePoint(codePoint);
    assert.deepEqual(hiddenFindingCodePoints(character), [
      formatCodePoint(codePoint),
    ]);
    assert.deepEqual(reviewedDefaultIgnorableProjection(`a${character}b`), {
      sanitized: `a${character}b`,
      removedCodePoints: [],
    });
  }
});

function hiddenFindingCodePoints(content: string): string[] {
  const findings = hiddenUnicodeFindings(artifact(content));
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.id, INVISIBLE_ID);
  const characters = findings[0]?.details?.characters;
  assert.ok(Array.isArray(characters));
  return characters.map(
    (character: { codePoint: string }) => character.codePoint,
  );
}

function artifact(content: string): Artifact {
  return {
    path: "contexts/security/unicode.md",
    absolutePath: "/repo/contexts/security/unicode.md",
    kind: "context",
    sizeBytes: Buffer.byteLength(content),
    contentClassification: "text",
    markdownParserEligible: true,
    content,
  };
}
