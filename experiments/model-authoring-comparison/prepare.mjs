import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, "../..");
if (process.argv.length > 3) {
  throw new Error("Usage: node prepare.mjs [new-output-file]");
}
const output = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(directory, "inputs/instructions.json");
const revisions = {
  baseline: "69a8fc6f64ee8406f671dd5a536b144f1d384913",
  current: "f3e3508dc204cb816782d97874b137e12d485035",
};
const snapshots = {};
const digest = (text) => createHash("sha256").update(text).digest("hex");
function source(revision, filename) {
  const text = execFileSync("git", ["show", `${revision}:${filename}`], {
    cwd: root,
    encoding: "utf8",
  });
  return { filename, sourceSha256: digest(text), text };
}
function excerpt(document, selector, text) {
  if (!text) throw new Error(`Empty excerpt: ${document.filename} ${selector}`);
  return {
    source: document.filename,
    sourceSha256: document.sourceSha256,
    selector,
    text,
    sha256: digest(text),
  };
}
for (const [variant, revision] of Object.entries(revisions)) {
  const guideSource = source(
    revision,
    "test/fixtures/public-json-expected/guide-skill.golden",
  );
  const guide = JSON.parse(guideSource.text);
  const authoring = [
    guide.interaction.openingRule,
    ...guide.interaction.truthSources,
    ...Object.values(guide.interaction.decisionClasses),
    ...Object.values(guide.interaction.progressionClasses),
    ...guide.interaction.questionRules,
    ...guide.interaction.creationGate,
  ].join("\n\n");
  const metadata = source(revision, "src/renderers/metadata-suggestion.ts");
  const noProposal = metadata.text
    .match(/: noChange\s*\? "([^"\n]+)"/g)
    ?.at(-1)
    ?.match(/\? "([^"\n]+)"/)?.[1];
  const agent = source(revision, "src/agent-skills.ts");
  const constraint = agent.text.match(
    /IDS\.RN_EXECUTION_CONSTRAINT_MISSING_ALTERNATIVE,\s*"warning",\s*"renma-authoring",\s*"([^"\n]+)"/,
  )?.[1];
  const docs = source(revision, "docs/authoring-guide.md");
  const startMarker =
    variant === "baseline"
      ? "Execute and test every script."
      : "Verify new or changed scripts";
  const start = docs.text.indexOf(startMarker);
  const end = docs.text.indexOf("### 4. Validate, fix, and rerun", start);
  if (start < 0 || end < start) throw new Error("Validation excerpt not found");
  const releaseSource = source(revision, "contexts/release/prep.md");
  const release = releaseSource.text
    .split("\n")
    .filter(
      (line) =>
        line.startsWith("GitHub Actions owns the package release step.") ||
        line.startsWith(
          "9. Generate and present the complete GitHub Release",
        ) ||
        line.startsWith("10. Determine whether the tag's GitHub Release") ||
        line.startsWith("- GitHub Release content approval"),
    )
    .join("\n\n");
  snapshots[variant] = {
    revision,
    excerpts: {
      authoring: excerpt(
        guideSource,
        "interaction.openingRule, truthSources, decisionClasses, progressionClasses, questionRules, creationGate (ordered projection)",
        authoring,
      ),
      "no-proposal": excerpt(
        metadata,
        "renderMetadataPrompt: final noChange branch",
        noProposal,
      ),
      constraint: excerpt(
        agent,
        "RN_EXECUTION_CONSTRAINT_MISSING_ALTERNATIVE message",
        constraint,
      ),
      validation: excerpt(
        docs,
        `${startMarker} through next validation heading (exclusive)`,
        docs.text.slice(start, end).trim(),
      ),
      release: excerpt(
        releaseSource,
        "English publication ownership, workflow steps 9-10, content/publication approval constraint",
        release,
      ),
    },
  };
}
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(snapshots, null, 2)}\n`, {
  flag: "wx",
});
console.log("Captured instruction excerpts from both pinned revisions.");
