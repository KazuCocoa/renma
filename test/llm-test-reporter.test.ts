import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";

const reporter = path.resolve("scripts/llm-test-reporter.mjs");
const fixture = path.resolve("test/fixtures/llm-test-reporter.fixture.mjs");

function runFixture(fail: boolean, extraEnv: NodeJS.ProcessEnv = {}) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    RENMA_REPORTER_FIXTURE_FAIL: fail ? "1" : "0",
    ...extraEnv,
  };
  if (env.FORCE_COLOR !== undefined) {
    delete env.NO_COLOR;
  }
  delete env.NODE_TEST_CONTEXT;

  return spawnSync(
    process.execPath,
    ["--test", `--test-reporter=${reporter}`, fixture],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env,
    },
  );
}

test("LLM test reporter reduces a successful run to one summary", () => {
  const result = runFixture(false);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, "PASS: 2 tests (1 passed; 1 skipped)\n");
});

test("LLM test reporter emits only failure details and a compact summary", () => {
  const result = runFixture(true, { FORCE_COLOR: "1" });

  assert.equal(result.status, 1);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /FAIL 1: failing fixture detail must be shown/);
  assert.match(result.stdout, /actual/);
  assert.match(result.stdout, /expected/);
  assert.doesNotMatch(result.stdout, /\u001B/);
  assert.match(
    result.stdout,
    /FAIL: 1\/3 tests failed \(1 passed; 1 skipped\)\./,
  );
  assert.match(result.stdout, /npm run test:verbose/);
  assert.doesNotMatch(result.stdout, /passing fixture detail must stay hidden/);
  assert.doesNotMatch(result.stdout, /passing fixture stdout must stay hidden/);
  assert.doesNotMatch(result.stdout, /skipped fixture detail must stay hidden/);
});

test("LLM test reporter bounds large failure output", () => {
  const result = runFixture(true, { RENMA_TEST_MAX_FAILURE_CHARS: "120" });

  assert.equal(result.status, 1);
  assert.match(result.stdout, /failure characters omitted/);
  assert.match(result.stdout, /FAIL: 1\/3 tests failed/);
  assert.doesNotMatch(result.stdout, /passing fixture stdout must stay hidden/);
});

test("LLM test reporter retains process-level failure metadata", () => {
  const result = runFixture(false, { RENMA_REPORTER_FIXTURE_EXIT: "1" });

  assert.equal(result.status, 1);
  assert.match(result.stdout, /FAIL 1: .*llm-test-reporter\.fixture\.mjs/);
  assert.match(result.stdout, /exitCode: 2/);
  assert.match(result.stdout, /FAIL: 1\/3 tests failed/);
});
