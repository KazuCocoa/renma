#!/usr/bin/env node
import packageJson from "../package.json" with { type: "json" };
import { main } from "./cli.js";
import { runSkillIndexCli } from "./commands/skill-index.js";

const args = process.argv.slice(2);

process.exitCode =
  args[0] === "skill-index"
    ? await runSkillIndexCli(args.slice(1), packageJson.version)
    : await main(args);
