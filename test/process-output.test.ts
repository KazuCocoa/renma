import assert from "node:assert/strict";
import test from "node:test";
import { captureProcessOutput } from "./process-output.js";

test("output capture restores both process streams after the action rejects", async () => {
  const stdoutWrite = process.stdout.write;
  const stderrWrite = process.stderr.write;
  const failure = new Error("test action failed");
  await assert.rejects(
    captureProcessOutput(async () => {
      process.stdout.write("partial output");
      process.stderr.write("partial error");
      await Promise.resolve();
      throw failure;
    }),
    (error) => error === failure,
  );
  assert.equal(process.stdout.write, stdoutWrite);
  assert.equal(process.stderr.write, stderrWrite);
});
