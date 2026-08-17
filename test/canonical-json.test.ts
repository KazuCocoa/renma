import assert from "node:assert/strict";
import test from "node:test";

import { canonicalJson, canonicalSha256 } from "../src/canonical-json.js";

const UNICODE_ORDER_FIXTURE = {
  中: "cjk",
  é: "precomposed-lower",
  z: "ascii-lower-z",
  É: "precomposed-upper",
  _: "underscore",
  a: "ascii-lower-a",
  "e\u0301": "combining-lower",
  A: "ascii-upper-a",
  "0": "ascii-digit",
};

const EXPECTED_CANONICAL_JSON =
  '{"0":"ascii-digit","A":"ascii-upper-a","_":"underscore","a":"ascii-lower-a","é":"combining-lower","z":"ascii-lower-z","É":"precomposed-upper","é":"precomposed-lower","中":"cjk"}';

test("canonical JSON uses explicit locale-independent UTF-16 key order", () => {
  assert.equal(canonicalJson(UNICODE_ORDER_FIXTURE), EXPECTED_CANONICAL_JSON);
});

test("canonical JSON preserves recursive object ordering and array order", () => {
  assert.equal(
    canonicalJson({
      z: [
        { é: 1, A: 2 },
        { 中: 3, "e\u0301": 4 },
      ],
      a: true,
    }),
    '{"a":true,"z":[{"A":2,"é":1},{"é":4,"中":3}]}',
  );
});

test("canonical SHA-256 identity locks the Unicode ordering contract", () => {
  assert.equal(
    canonicalSha256(UNICODE_ORDER_FIXTURE),
    "sha256:3c8017cd3841bd2b992d763bab267813982fd97fc8ed1936bfbba631acf50da2",
  );
});
