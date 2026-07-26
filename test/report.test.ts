import assert from "node:assert/strict";
import test from "node:test";

import { formatJsonDocument } from "../src/report.js";

test("JSON documents preserve insertion order with exact pretty printing", () => {
  const value = {
    z: null,
    a: {
      nested: [1, null, { second: 2, first: 1 }],
      optional: undefined,
    },
  };

  assert.equal(
    formatJsonDocument(value),
    [
      "{",
      '  "z": null,',
      '  "a": {',
      '    "nested": [',
      "      1,",
      "      null,",
      "      {",
      '        "second": 2,',
      '        "first": 1',
      "      }",
      "    ]",
      "  }",
      "}",
      "",
    ].join("\n"),
  );
  assert.equal(formatJsonDocument(value).endsWith("\n\n"), false);
});
