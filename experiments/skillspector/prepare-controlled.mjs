import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const experimentRoot = import.meta.dirname;
const fixtureRoot = path.join(experimentRoot, "fixtures", "controlled");
const generatedRoot = path.join(
  experimentRoot,
  "generated",
  "controlled-fixture",
  "source",
);
const cases = [
  ["intentional-positive", "intentional-positive.template"],
  ["link-false-positive", "link-false-positive.template"],
  ["clean-control", "clean-control.template"],
];

await rm(generatedRoot, { recursive: true, force: true });

for (const [caseName, templateName] of cases) {
  const content = await readFile(path.join(fixtureRoot, templateName), "utf8");
  const destinations = [
    path.join(generatedRoot, caseName, "SKILL.md"),
    path.join(generatedRoot, "combined", caseName, "SKILL.md"),
  ];
  for (const destination of destinations) {
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, content);
  }
}

process.stdout.write(
  `Materialized ${cases.length} inert controlled cases and one combined corpus under ${generatedRoot}\n`,
);
