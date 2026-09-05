import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
if (process.argv.length > 3) {
  throw new Error("Usage: node verify.mjs [capture-directory]");
}
const json = async (filename) => JSON.parse(await readFile(filename, "utf8"));
const digest = (value) => createHash("sha256").update(value).digest("hex");
const cases = await json(path.join(directory, "cases.json"));
const instructionFile = path.join(directory, "inputs/instructions.json");
const instructions = await json(instructionFile);
assert.equal(new Set(cases.map((entry) => entry.id)).size, cases.length);
const temporary = await mkdtemp(path.join(os.tmpdir(), "renma-eval-verify-"));
try {
  const regenerated = path.join(temporary, "instructions.json");
  execFileSync(
    process.execPath,
    [path.join(directory, "prepare.mjs"), regenerated],
    {
      stdio: "pipe",
    },
  );
  assert.deepEqual(
    await readFile(regenerated),
    await readFile(instructionFile),
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
const publicSources = await json(
  path.join(directory, "inputs/public-source-verification.json"),
);
assert.equal(publicSources.private, false);
for (const [variant, snapshot] of Object.entries(instructions)) {
  for (const excerpt of Object.values(snapshot.excerpts)) {
    assert.equal(digest(excerpt.text), excerpt.sha256);
    const url = `https://raw.githubusercontent.com/KazuCocoa/renma/${snapshot.revision}/${excerpt.source}`;
    assert.ok(
      publicSources.sources.some(
        (source) =>
          source.variant === variant &&
          source.url === url &&
          source.sha256 === excerpt.sourceSha256,
      ),
      `Missing public-source evidence: ${url}`,
    );
  }
  for (const entry of cases) assert.ok(snapshot.excerpts[entry.guidance]);
}
assert.equal(
  instructions.baseline.excerpts.release.sha256,
  instructions.current.excerpts.release.sha256,
);
console.log(
  "Inputs verified against pinned repository sources and retained public-source evidence.",
);

if (process.argv[2]) {
  const capture = path.resolve(process.argv[2]);
  const manifest = await json(path.join(capture, "manifest.json"));
  for (const [filename, expected] of Object.entries(manifest.inputHashes)) {
    assert.equal(
      digest(await readFile(path.join(directory, filename))),
      expected,
      filename,
    );
  }
  assert.equal(manifest.repetitions, 1);
  const cellId = ({ caseId, variant, model }) =>
    `${caseId}--${variant}--${model}`;
  const expectedCells = cases.flatMap((entry) =>
    Object.keys(instructions).flatMap((variant) =>
      manifest.models.map((model) =>
        cellId({ caseId: entry.id, variant, model }),
      ),
    ),
  );
  assert.deepEqual(manifest.jobs.map(cellId).sort(), expectedCells.sort());
  let completed = 0;
  const metadataById = new Map();
  for (const job of manifest.jobs) {
    const id = cellId(job);
    const target = path.join(capture, id);
    const metadata = await json(path.join(target, "metadata.json"));
    const prompt = await readFile(path.join(target, "prompt.txt"), "utf8");
    const response = await readFile(path.join(target, "response.txt"), "utf8");
    const entry = cases.find((item) => item.id === job.caseId);
    const expectedPrompt = `${manifest.wrapper}\n\nApplicable Renma guidance:\n${instructions[job.variant].excerpts[entry.guidance].text}\n\nLatest user request and task evidence:\n${entry.prompt}\n`;
    assert.equal(prompt, expectedPrompt, `${id}: exact input`);
    assert.equal(metadata.caseId, job.caseId);
    assert.equal(metadata.variant, job.variant);
    assert.equal(metadata.requestedModel, job.model);
    assert.equal(metadata.promptSha256, digest(prompt));
    assert.equal(metadata.responseSha256, digest(response));
    const events = (await readFile(path.join(target, "events.jsonl"), "utf8"))
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    assert.ok(events.every((event) => event.item?.type !== "reasoning"));
    const lastMessage = events.findLast(
      (event) =>
        event.type === "item.completed" && event.item?.type === "agent_message",
    );
    assert.equal(response, lastMessage?.item.text ?? "");
    assert.ok(["completed", "inconclusive"].includes(metadata.status));
    if (metadata.status === "completed") {
      assert.equal(metadata.exitCode, 0);
      assert.equal(metadata.timedOut, false);
      assert.deepEqual(metadata.errorEvents, []);
      assert.deepEqual(metadata.unexpectedItems, []);
      assert.deepEqual(metadata.unparsed, []);
      assert.ok(response.length > 0);
      const completion = events.findLast(
        (event) => event.type === "turn.completed",
      );
      assert.ok(completion);
      assert.deepEqual(metadata.usage, completion.usage);
      completed++;
    }
    metadataById.set(id, metadata);
  }
  let assessments;
  try {
    assessments = await json(path.join(capture, "assessments.json"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (assessments) {
    assert.ok(assessments.assessor);
    assert.equal(
      assessments.manifestSha256,
      digest(await readFile(path.join(capture, "manifest.json"))),
    );
    assert.deepEqual(
      assessments.results.map(cellId).sort(),
      expectedCells.sort(),
    );
    for (const row of assessments.results) {
      const metadata = metadataById.get(cellId(row));
      assert.equal(row.responseSha256, metadata.responseSha256);
      assert.ok(["pass", "fail", "inconclusive"].includes(row.outcome));
      if (metadata.status !== "completed")
        assert.equal(row.outcome, "inconclusive");
      assert.ok(row.rationale);
    }
    console.log(
      "Assessment coverage and response digests verified; scores require qualitative review.",
    );
  }
  console.log(
    `Capture verified: ${completed}/${manifest.jobs.length} completed, ${manifest.jobs.length - completed} inconclusive.`,
  );
}
