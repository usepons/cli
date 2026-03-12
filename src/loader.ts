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
import { join, resolve } from "node:path";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
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
    return JSON.parse(readFileSync(manifestPath, "utf-8")) as ModuleManifest;
  } catch {
    return null;
  }
}

/**
 * Load a CLI entrypoint from a manifest + directory.
 * The entrypoint module must export an `init(program: Command)` function.
 * Returns true if the entrypoint was loaded successfully.
 */
async function loadCliEntrypoint(
  program: Command,
  dir: string,
  manifest: ModuleManifest,
): Promise<boolean> {
  if (!manifest.cli) return false;

  const entrypoint = manifest.cli.entrypoint || "cli.ts";
  const cliPath = join(dir, entrypoint);

  if (!existsSync(cliPath)) return false;

  try {
    // Resolve symlinks so Deno uses the correct import map context
    const realPath = realpathSync(cliPath);
    const cliModule = (await import(
      pathToFileURL(realPath).href
    )) as CliExport;

    if (typeof cliModule.init === "function") {
      await cliModule.init(program);
      return true;
    }
  } catch (error) {
    if (process.env["DEBUG"]) {
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
export async function loadDynamicCommands(program: Command): Promise<void> {
  const home = getPonsHome();
  const kernelDir = resolve(home, "kernel");

  // ─── Kernel ──────────────────────────────────────────────────
  const kernelManifest = readManifest(kernelDir);
  if (!kernelManifest) return; // Kernel not installed — nothing to load

  await loadCliEntrypoint(program, kernelDir, kernelManifest);

  // ─── Modules ─────────────────────────────────────────────────
  // Dynamically import the kernel's ModuleLoader to discover modules
  try {
    const loaderModulePath = join(kernelDir, "src", "module", "loader.ts");
    if (!existsSync(loaderModulePath)) return;

    // Resolve symlinks so Deno uses the correct import map context
    const realLoaderPath = realpathSync(loaderModulePath);
    const loaderModule = await import(
      pathToFileURL(realLoaderPath).href
    );
    const ModuleLoader = loaderModule.ModuleLoader;

    // ModuleLoader requires a KernelLogger — use a silent stub
    const silentLogger = {
      trace() {},
      debug() {},
      info() {},
      warn() {},
      error() {},
      fatal() {},
      child() {
        return silentLogger;
      },
      isLevelEnabled() {
        return false;
      },
    };

    const loader = new ModuleLoader(silentLogger);
    const modulesDir = resolve(home, "modules");
    const discovered = loader.discover(modulesDir);

    for (const { manifest } of discovered) {
      const moduleDir = join(modulesDir, manifest.id);
      await loadCliEntrypoint(program, moduleDir, manifest);
    }
  } catch (error) {
    if (process.env["DEBUG"]) {
      console.error(
        `  Warning: Failed to discover modules: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
