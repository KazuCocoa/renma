#!/usr/bin/env node
import { main } from "./cli.js";
import { runValidateSkillsCli } from "./commands/validate-skills.js";

const [command, ...args] = process.argv.slice(2);
process.exitCode =
  command === "validate-skills"
    ? await runValidateSkillsCli(args)
    : await main();
