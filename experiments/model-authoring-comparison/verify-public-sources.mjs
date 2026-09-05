import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const output = process.argv[2];
if (!output || process.argv.length !== 3) {
  throw new Error("Usage: node verify-public-sources.mjs <new-output-file>");
}
const snapshots = JSON.parse(
  await readFile(path.join(directory, "inputs/instructions.json"), "utf8"),
);
const repository = "KazuCocoa/renma";
async function get(url) {
  const response = await fetch(url, {
    headers: { "User-Agent": "renma-public-source-verification" },
    signal: AbortSignal.timeout(30000),
    redirect: "error",
  });
  if (!response.ok) throw new Error(`${response.status}: ${url}`);
  return response;
}
// Anonymous GET requests only: no login, credential, or repository payload sent.
const repositoryUrl = `https://api.github.com/repos/${repository}`;
const information = await (await get(repositoryUrl)).json();
if (information.private !== false || information.full_name !== repository) {
  throw new Error("The expected repository is not confirmed public");
}
const sources = [];
for (const [variant, snapshot] of Object.entries(snapshots)) {
  for (const excerpt of Object.values(snapshot.excerpts)) {
    const url = `https://raw.githubusercontent.com/${repository}/${snapshot.revision}/${excerpt.source}`;
    const body = Buffer.from(await (await get(url)).arrayBuffer());
    const sha256 = createHash("sha256").update(body).digest("hex");
    if (sha256 !== excerpt.sourceSha256) {
      throw new Error(`Public source digest mismatch: ${url}`);
    }
    sources.push({ variant, url, sha256 });
  }
}
await writeFile(
  output,
  `${JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      method:
        "Unauthenticated HTTPS GET, redirects rejected, source bytes SHA-256 compared with the retained instruction snapshot",
      repositoryUrl,
      private: information.private,
      sources,
    },
    null,
    2,
  )}\n`,
  { flag: "wx" },
);
console.log(`Verified ${sources.length} public source files: ${output}`);
