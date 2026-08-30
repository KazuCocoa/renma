import assert from "node:assert/strict";
import test from "node:test";

test("passing fixture detail must stay hidden", () => {
  console.log("passing fixture stdout must stay hidden");
  assert.equal(1, 1);
});

test("skipped fixture detail must stay hidden", { skip: "fixture" }, () => {});

if (process.env.RENMA_REPORTER_FIXTURE_FAIL === "1") {
  test("failing fixture detail must be shown", () => {
    assert.equal("actual value", "expected value");
  });
}

if (process.env.RENMA_REPORTER_FIXTURE_EXIT === "1") {
  process.exitCode = 2;
}
