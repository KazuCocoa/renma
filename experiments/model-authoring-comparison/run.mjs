import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const outputArgument = process.argv[2];
if (!outputArgument || process.argv.length !== 3) {
  throw new Error("Usage: node run.mjs <new-output-directory>");
}
const output = path.resolve(outputArgument);
const root = path.resolve(directory, "../..");
const cli = process.env.RENMA_EVAL_CODEX || "codex";
const cases = JSON.parse(
  await readFile(path.join(directory, "cases.json"), "utf8"),
);
const snapshots = JSON.parse(
  await readFile(path.join(directory, "inputs/instructions.json"), "utf8"),
);
const digest = (text) => createHash("sha256").update(text).digest("hex");
const models = ["gpt-5.6-sol", "gpt-6-astra"];
const variants = ["baseline", "current"];
const wrapper =
  "This is a single-turn continuation exercise. Use only the supplied Renma guidance and task evidence. Do not access tools, files, services, or other conversations. Respond to the latest user in Japanese, except where they request English or Markdown content. Return the response you would give at this point, including a proposed text replacement when requested. Do not claim you executed commands or changed files in this exercise. Do not discuss the experiment itself.";
const disabled = [
  "plugins",
  "apps",
  "multi_agent",
  "shell_tool",
  "browser_use",
  "computer_use",
  "image_generation",
  "view_image",
  "skill_search",
  "shell_snapshot",
  "hooks",
  "memories",
];
const settings = [
  "--ignore-user-config",
  "--ephemeral",
  "--skip-git-repo-check",
  "-s",
  "read-only",
  "-c",
  'model_reasoning_effort="medium"',
  "-c",
  'web_search="disabled"',
  "-c",
  "project_doc_max_bytes=0",
  ...disabled.flatMap((flag) => ["--disable", flag]),
  "--json",
];
// Paired, counterbalanced ordering; no model sees the other arm or the rubric.
const jobs = cases.flatMap((entry, index) => {
  const order = index % 2 === 0 ? variants : [...variants].reverse();
  return order.flatMap((variant) =>
    models.map((model) => ({ entry, variant, model })),
  );
});
await mkdir(path.dirname(output), { recursive: true });
await mkdir(output); // refuse to overwrite a capture
const sourcePaths = [
  "cases.json",
  "RUBRIC.md",
  "inputs/instructions.json",
  "inputs/public-source-verification.json",
  "run.mjs",
  "prepare.mjs",
  "verify-public-sources.mjs",
  "verify.mjs",
];
const inputHashes = {};
for (const filename of sourcePaths)
  inputHashes[filename] = digest(
    await readFile(path.join(directory, filename)),
  );
await writeFile(
  path.join(output, "manifest.json"),
  `${JSON.stringify(
    {
      experiment: "renma-model-authoring-smoke-v0",
      startedAt: new Date().toISOString(),
      repositoryRevision: execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: root,
        encoding: "utf8",
      }).trim(),
      repositoryStatus: execFileSync("git", ["status", "--short"], {
        cwd: root,
        encoding: "utf8",
      }),
      cliExecutable: cli,
      cliVersion: execFileSync(cli, ["--version"], {
        encoding: "utf8",
      }).trim(),
      models,
      reasoningEffort: "medium",
      variants,
      repetitions: 1,
      concurrency: 2,
      perSessionTimeoutMs: 120000,
      settings,
      wrapper,
      inputHashes,
      sourceRevisions: Object.fromEntries(
        Object.entries(snapshots).map(([key, value]) => [key, value.revision]),
      ),
      design:
        "Single-turn natural-language continuation using selected instruction excerpts; no actual editing, validation, publication, or source retrieval.",
      provenanceLimit:
        "Model IDs are requested CLI model IDs, not independently verified immutable provider snapshots. Codex built-in instructions may differ by model.",
      eventCapture:
        "CLI JSONL with reasoning items omitted and credential-shaped strings redacted; raw stdout digest retained. No private reasoning text is stored.",
      jobs: jobs.map(({ entry, variant, model }) => ({
        caseId: entry.id,
        variant,
        model,
      })),
    },
    null,
    2,
  )}\n`,
);

function redact(text) {
  return text
    .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, "<REDACTED_KEY>")
    .replace(/Bearer\s+[A-Za-z0-9._~-]{16,}/gi, "Bearer <REDACTED>")
    .replaceAll(os.homedir(), "<HOME>");
}
async function execute({ entry, variant, model }) {
  const id = `${entry.id}--${variant}--${model}`;
  const target = path.join(output, id);
  await mkdir(target);
  const prompt = `${wrapper}\n\nApplicable Renma guidance:\n${snapshots[variant].excerpts[entry.guidance].text}\n\nLatest user request and task evidence:\n${entry.prompt}\n`;
  await writeFile(path.join(target, "prompt.txt"), prompt);
  const workspace = await mkdtemp(path.join(os.tmpdir(), "renma-model-case-"));
  const args = ["exec", ...settings, "-C", workspace, "-m", model, "-"];
  const startedAt = new Date().toISOString();
  const start = performance.now();
  let stdout = "",
    stderr = "",
    timedOut = false;
  const processResult = await new Promise((resolve) => {
    const child = spawn(cli, args, {
      cwd: workspace,
      stdio: ["pipe", "pipe", "pipe"],
      detached: true,
    });
    let killTimer;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        /* Already finished. */
      }
      killTimer = setTimeout(() => {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          /* Already finished. */
        }
      }, 5000);
    }, 120000);
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      resolve({ exitCode: null, error: error.message });
    });
    child.on("close", (exitCode, signal) => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      resolve({ exitCode, signal });
    });
    child.stdin.on("error", () => {});
    child.stdin.end(prompt);
  });
  const events = [],
    unparsed = [];
  let omittedReasoningEvents = 0;
  for (const line of stdout.split("\n").filter(Boolean)) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      unparsed.push(redact(line));
      continue;
    }
    if (event.item?.type === "reasoning") {
      omittedReasoningEvents++;
      continue;
    }
    events.push(JSON.parse(redact(JSON.stringify(event))));
  }
  const completion = events.findLast(
    (event) => event.type === "turn.completed",
  );
  const messages = events
    .filter(
      (event) =>
        event.type === "item.completed" && event.item?.type === "agent_message",
    )
    .map((event) => event.item.text);
  const response = messages.at(-1) ?? "";
  const unexpectedItems = events
    .filter(
      (event) =>
        event.type === "item.completed" && event.item?.type !== "agent_message",
    )
    .map((event) => event.item.type);
  const errorEvents = events.filter(
    (event) => event.type === "error" || event.type === "turn.failed",
  );
  const status =
    processResult.exitCode === 0 &&
    completion &&
    response &&
    !timedOut &&
    unexpectedItems.length === 0 &&
    errorEvents.length === 0 &&
    unparsed.length === 0
      ? "completed"
      : "inconclusive";
  await writeFile(path.join(target, "response.txt"), response);
  await writeFile(
    path.join(target, "events.jsonl"),
    `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
  );
  await writeFile(path.join(target, "stderr.txt"), redact(stderr));
  await writeFile(
    path.join(target, "metadata.json"),
    `${JSON.stringify(
      {
        caseId: entry.id,
        variant,
        requestedModel: model,
        reportedImmutableModel: null,
        startedAt,
        finishedAt: new Date().toISOString(),
        elapsedMs: Math.round(performance.now() - start),
        status,
        ...processResult,
        timedOut,
        promptSha256: digest(prompt),
        responseSha256: digest(response),
        rawStdoutSha256: digest(stdout),
        omittedReasoningEvents,
        unparsed,
        unexpectedItems,
        errorEvents,
        usage: completion?.usage ?? null,
        cliArgs: args.map((arg) =>
          arg === workspace ? "<ISOLATED_TEMP_WORKSPACE>" : arg,
        ),
      },
      null,
      2,
    )}\n`,
  );
  await rm(workspace, { recursive: true, force: true });
  console.log(`${status}: ${id}`);
}
let cursor = 0;
await Promise.all(
  [0, 1].map(async () => {
    while (cursor < jobs.length) await execute(jobs[cursor++]);
  }),
);
console.log(`Captured ${jobs.length} sessions in ${output}`);
