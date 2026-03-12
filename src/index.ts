#!/usr/bin/env node

/**
 * Pons CLI — Lightweight command loader for the Pons gateway.
 *
 * Own commands: install, update, delete, onboard
 * Dynamic commands: loaded from kernel + modules at runtime
 *
 * Usage:
 *   pons <command> [options]
 */

import { Command } from "commander";
import { toErrorMessage } from "@pons/sdk";

import { registerOnboardCommand } from "./commands/onboard.ts";
import { registerCompletionCommand } from "./commands/completion.ts";
import { installKernel, updateKernel, updateCli, deleteKernel } from "./kernel-manager.ts";
import { loadDynamicCommands } from "./loader.ts";
import { CLI_VERSION } from "./version.ts";

const program = new Command();

program
  .name("pons")
  .description("Pons CLI — modular AI gateway")
  .version(CLI_VERSION)
  .option("--json", "Output results as JSON")
  .configureHelp({
    sortSubcommands: true,
    sortOptions: true,
  });

// ─── CLI's own commands (always available) ──────────────────

program
  .command("install")
  .description("Install the Pons kernel to ~/.pons/")
  .option("--force", "Reinstall even if kernel is already installed")
  .addHelpText("after", "\nExamples:\n  $ pons install\n  $ pons install --force")
  .action(async (opts) => {
    const success = await installKernel(undefined, opts.force);
    if (!success) process.exitCode = 1;
  });

program
  .command("update")
  .description("Update CLI and kernel to latest versions")
  .addHelpText("after", "\nExamples:\n  $ pons update\n  $ pons update --json")
  .action(async () => {
    const json = program.opts().json;
    const cliOk = await updateCli(json);
    const kernelOk = await updateKernel(undefined, json);
    if (!cliOk || !kernelOk) process.exitCode = 1;
  });

program
  .command("delete")
  .description("Remove kernel and optionally all Pons data")
  .addHelpText("after", "\nExamples:\n  $ pons delete")
  .action(async () => {
    await deleteKernel();
  });

registerOnboardCommand(program);
registerCompletionCommand(program);

// ─── Dynamic commands from kernel + modules ─────────────────

loadDynamicCommands(program).then(() => {
  return program.parseAsync(process.argv);
}).then(() => {
  // Force exit after command completes — Node.js fetch (undici) keeps
  // connections alive in the global pool, preventing clean shutdown.
  process.exit(process.exitCode ?? 0);
}).catch((error: unknown) => {
  console.error(`Error: ${toErrorMessage(error)}`);
  process.exit(1);
});
