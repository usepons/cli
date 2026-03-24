/**
 * Dynamic CLI command loader.
 *
 * Discovers the kernel and modules at runtime, dynamically imports
 * their CLI entrypoints, and registers commands on the Commander program.
 *
 * If the kernel is not installed (~/.pons/kernel/module.json missing),
 * returns silently — the CLI shows only its own built-in commands.
 */

import type { Command } from "commander";
import { join, resolve, toFileUrl } from "@std/path";
import { existsSync } from "@std/fs";
import { getPonsHome } from "@pons/sdk";
import type { ModuleManifest } from "@pons/sdk";

interface CliExport {
  init(program: Command): void | Promise<void>;
}

/**
 * Read and parse a module.json manifest from a directory.
 * Returns null if the file doesn't exist or can't be parsed.
 */
function readManifest(dir: string): ModuleManifest | null {
  const manifestPath = join(dir, "module.json");
  if (!existsSync(manifestPath)) return null;

  try {
    return JSON.parse(Deno.readTextFileSync(manifestPath)) as ModuleManifest;
  } catch {
    return null;
  }
}

/**
 * Load a CLI entrypoint from a manifest + directory.
 * The entrypoint module must export an `init(program: Command)` function.
 * Returns true if the entrypoint was loaded successfully.
 */
async function loadCliEntrypoint(program: Command, dir: string, manifest: ModuleManifest,): Promise<boolean> {

  if (!manifest.cli) return false;

  const entrypoint = manifest.cli.entrypoint || "cli.ts";
  const cliPath = join(dir, entrypoint);

  if (!existsSync(cliPath)) return false;

  try {
    // Resolve symlinks so Deno uses the correct import map context
    const realPath = Deno.realPathSync(cliPath);
    const cliModule = (await import(
      toFileUrl(realPath).href
    )) as CliExport;


    if (typeof cliModule.init === "function") {
      await cliModule.init(program);
      return true;
    }
  } catch (error) {
    if (Deno.env.get("DEBUG")) {
      console.error(
        `  Warning: Failed to load CLI from ${manifest.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  return false;
}

/**
 * Discover and load all CLI commands from the kernel and installed modules.
 *
 * 1. Check if the kernel is installed at ~/.pons/kernel/
 * 2. Load the kernel's CLI entrypoint (registers kernel commands)
 * 3. Use the kernel's ModuleLoader to discover installed modules
 * 4. Load each module's CLI entrypoint
 *
 * If the kernel is not installed, returns silently so the CLI
 * only shows its own built-in commands.
 */
export async function loadDynamicCommands(program: Command, kernelPath?: string): Promise<void> {
  const home = getPonsHome();
  const kernelDir = kernelPath ? resolve(kernelPath) : resolve(home, "kernel");

  // ─── Kernel ──────────────────────────────────────────────────
  const kernelManifest = readManifest(kernelDir);
  if (!kernelManifest) {
    console.log('\n  Kernel is not installed. Run "pons install" to get started.\n');
    return; // Kernel not installed — nothing to load
  }

  await loadCliEntrypoint(program, kernelDir, kernelManifest);

  // ─── Modules ─────────────────────────────────────────────────
  // Dynamically import the kernel's ModuleLoader to discover modules
  try {
    const loaderModulePath = join(kernelDir, "src", "module", "loader.ts");
    if (!existsSync(loaderModulePath)) return;

    // Resolve symlinks so Deno uses the correct import map context
    const realLoaderPath = Deno.realPathSync(loaderModulePath);
    const loaderModule = await import(
      toFileUrl(realLoaderPath).href
    );
    const ModuleLoader = loaderModule.ModuleLoader;

    const modulesDir = resolve(home, "modules");
    const loader = new ModuleLoader(modulesDir);
    const discovered = loader.discover();

    for (const { manifest } of discovered) {
      const moduleDir = join(modulesDir, manifest.id);
      await loadCliEntrypoint(program, moduleDir, manifest);
    }
  } catch (error) {
      console.error(
        `  Warning: Failed to discover modules: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
  }
}
