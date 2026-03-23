#!/usr/bin/env -S deno run --allow-all

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
import { installKernel, installKernelLocal, updateKernel, updateCli, deleteKernel } from "./kernel-manager.ts";
import { loadDynamicCommands } from "./loader.ts";
import { CLI_VERSION } from "./version.ts";

let exitCode = 0;

const program = new Command();

program
  .name("pons")
  .description("Pons CLI — modular AI gateway")
  .version(CLI_VERSION)
  .option("--json", "Output results as JSON")
  .option("--kernel-path <path>", "Use a local kernel directory (dev)")
  .configureHelp({
    sortSubcommands: true,
    sortOptions: true,
  });

// ─── CLI's own commands (always available) ──────────────────

program
  .command("install")
  .description("Install the Pons kernel to ~/.pons/")
  .option("--force", "Reinstall even if kernel is already installed")
  .option("--local <path>", "Symlink a local kernel directory instead of downloading from JSR")
  .addHelpText("after", "\nExamples:\n  $ pons install\n  $ pons install --force\n  $ pons install --local ./kernel")
  .action(async (opts) => {
    const success = opts.local
      ? await installKernelLocal(opts.local, opts.force)
      : await installKernel(undefined, opts.force);
    if (!success) exitCode = 1;
  });

program
  .command("update")
  .description("Update CLI and kernel to latest versions")
  .addHelpText("after", "\nExamples:\n  $ pons update\n  $ pons update --json")
  .action(async () => {
    const json = program.opts().json;
    const cliOk = await updateCli(json);
    const kernelOk = await updateKernel(undefined, json);
    if (!cliOk || !kernelOk) exitCode = 1;
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

// Pre-parse to extract --kernel-path before Commander runs
const kernelPathIdx = Deno.args.indexOf("--kernel-path");
const kernelPath = kernelPathIdx !== -1 ? Deno.args[kernelPathIdx + 1] : undefined;

loadDynamicCommands(program, kernelPath).then(() => {
  return program.parseAsync(Deno.args, { from: "user" });
}).then(() => {
  // Force exit after command completes — fetch keeps connections alive
  // in the global pool, preventing clean shutdown.
  Deno.exit(exitCode);
}).catch((error: unknown) => {
  console.error(`Error: ${toErrorMessage(error)}`);
  Deno.exit(1);
});
