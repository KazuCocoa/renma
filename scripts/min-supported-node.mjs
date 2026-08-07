import { readFile } from "node:fs/promises";
import { URL } from "node:url";

const packageJsonUrl = new URL("../package.json", import.meta.url);

let packageJson;
try {
  packageJson = JSON.parse(await readFile(packageJsonUrl, "utf8"));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  throw new Error(`Unable to read package.json: ${message}`, { cause: error });
}

const engine = packageJson.engines?.node;
const match = /^>=(\d+\.\d+\.\d+)$/u.exec(engine ?? "");

if (!match) {
  throw new Error(
    `Unsupported package.json engines.node contract ${JSON.stringify(engine)}. ` +
      'Expected the exact lower-bound form ">=x.y.z".',
  );
}

process.stdout.write(`${match[1]}\n`);
