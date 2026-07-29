import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const experimentRoot = import.meta.dirname;
const fixtureRoot = path.join(experimentRoot, "fixtures", "allowed-tools");
const repositoryRoot = path.join(
  experimentRoot,
  "generated",
  "allowed-tools",
  "repositories",
);
const cases = [
  { id: "no-declaration", probe: true },
  { id: "single-read", probe: true },
  { id: "single-webfetch", probe: true },
  { id: "standard-multi-tool", probe: true },
  { id: "standard-qualified-tools", probe: true },
  { id: "producer-comma-contrast", probe: true },
  { id: "docs-only-standard", probe: false },
];
const probeContent = await readFile(
  path.join(fixtureRoot, "probe.py.template"),
  "utf8",
);

await rm(repositoryRoot, { recursive: true, force: true });

for (const fixtureCase of cases) {
  const skillRoot = path.join(
    repositoryRoot,
    fixtureCase.id,
    "skills",
    fixtureCase.id,
  );
  const skillContent = await readFile(
    path.join(fixtureRoot, `${fixtureCase.id}.template`),
    "utf8",
  );
  await mkdir(skillRoot, { recursive: true });
  await writeFile(path.join(skillRoot, "SKILL.md"), skillContent);

  if (fixtureCase.probe) {
    const scriptRoot = path.join(skillRoot, "scripts");
    await mkdir(scriptRoot, { recursive: true });
    await writeFile(path.join(scriptRoot, "probe.py"), probeContent);
  }
}

process.stdout.write(
  `Materialized ${cases.length} inert allowed-tools cases under ${repositoryRoot}\n`,
);
