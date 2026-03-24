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
import {
  deleteKernel,
  installKernel,
  installKernelLocal,
  updateCli,
  updateKernel,
} from "./kernel-manager.ts";
import { loadDynamicCommands } from "./loader.ts";
import { CLI_VERSION } from "./version.ts";

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
  .option(
    "--local <path>",
    "Symlink a local kernel directory instead of downloading from JSR",
  )
  .addHelpText(
    "after",
    "\nExamples:\n  $ pons install\n  $ pons install --force\n  $ pons install --local ./kernel",
  )
  .action(async (opts) => {
    opts.local
      ? await installKernelLocal(opts.local, opts.force)
      : await installKernel(undefined, opts.force);
  });

program
  .command("update")
  .description("Update CLI and kernel to latest versions")
  .addHelpText("after", "\nExamples:\n  $ pons update\n  $ pons update --json")
  .action(async () => {
    const json = program.opts().json;
    await updateCli(json);
    await updateKernel(undefined, json);
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
const kernelPath = kernelPathIdx !== -1
  ? Deno.args[kernelPathIdx + 1]
  : undefined;

loadDynamicCommands(program, kernelPath)
  .then(() => program.parseAsync(Deno.args, { from: "user" }))
  .catch((error: unknown) => {
    console.error(`Error: ${toErrorMessage(error)}`);
    Deno.exit(1);
  });
