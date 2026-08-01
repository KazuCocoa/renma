import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const experimentRoot = import.meta.dirname;
const templateRoot = path.join(experimentRoot, "fixtures", "repository");
const outputRoot = path.join(
  experimentRoot,
  "..",
  "..",
  "generated",
  "evidence-correlation-executable-context",
  "repository",
);

await rm(outputRoot, { recursive: true, force: true });
await copyTemplates(templateRoot, outputRoot);
process.stdout.write(
  `Materialized inert executable-context fixture under ${outputRoot}\n`,
);

async function copyTemplates(sourceDirectory, destinationDirectory) {
  for (const entry of await readdir(sourceDirectory, { withFileTypes: true })) {
    const source = path.join(sourceDirectory, entry.name);
    if (entry.isDirectory()) {
      await copyTemplates(source, path.join(destinationDirectory, entry.name));
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".template")) continue;
    const destination = path.join(
      destinationDirectory,
      entry.name.slice(0, -".template".length),
    );
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, await readFile(source));
  }
}
