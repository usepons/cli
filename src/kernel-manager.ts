/**
 * Kernel Manager — Install, update, and delete the Pons kernel.
 *
 * The kernel is published to JSR as `jsr:@pons/kernel` and lives at
 * `~/.pons/kernel/` with a `module.json` manifest.
 *
 * Uses the JSR registry API to fetch package files:
 *   - meta.json        → latest version
 *   - <version>_meta.json → file manifest
 *   - <version>/<path> → individual file content
 */

import { dirname, join } from "@std/path";
import { existsSync } from "@std/fs";
import ora from "ora";
import chalk from "chalk";
import * as clack from "@clack/prompts";
import { getPonsHome } from "@pons/sdk";
import type { ModuleManifest } from "@pons/sdk";
import { setupCompletions } from "./commands/completion.ts";
import { CLI_VERSION } from "./version.ts";

// ─── Constants ──────────────────────────────────────────────

const JSR_SCOPE = "pons";
const JSR_NAME = "kernel";
const JSR_BASE = `https://jsr.io/@${JSR_SCOPE}/${JSR_NAME}`;
const KERNEL_DIR_NAME = "kernel";
const MANIFEST_FILE = "module.json";

// ─── JSR API Types ──────────────────────────────────────────

interface JsrPackageMeta {
  scope: string;
  name: string;
  latest: string;
  versions: Record<string, { yanked?: boolean }>;
}

interface JsrVersionMeta {
  manifest: Record<string, { size: number; checksum: string }>;
  exports: Record<string, string>;
}

// ─── Helpers ────────────────────────────────────────────────

/** Remove a path recursively, ignoring NotFound errors (like rm -rf). */
function forceRemoveSync(path: string): void {
  try {
    Deno.removeSync(path, { recursive: true });
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e;
  }
}

// ─── JSR Helpers ────────────────────────────────────────────

/**
 * Fetch the latest version string from JSR.
 */
async function fetchLatestVersion(): Promise<string> {
  const res = await fetch(`${JSR_BASE}/meta.json`, {
    headers: { Accept: "application/json" },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch package metadata: HTTP ${res.status}`);
  }

  const meta = (await res.json()) as JsrPackageMeta;
  return meta.latest;
}

/**
 * Fetch the file manifest for a specific version.
 */
async function fetchVersionManifest(
  version: string,
): Promise<JsrVersionMeta> {
  const res = await fetch(`${JSR_BASE}/${version}_meta.json`, {
    headers: { Accept: "application/json" },
  });

  if (!res.ok) {
    throw new Error(
      `Failed to fetch version metadata for ${version}: HTTP ${res.status}`,
    );
  }

  return (await res.json()) as JsrVersionMeta;
}

/**
 * Download all files from a JSR package version into a target directory.
 */
async function downloadPackageFiles(
  version: string,
  versionMeta: JsrVersionMeta,
  targetDir: string,
  onProgress?: (current: number, total: number) => void,
): Promise<void> {
  const filePaths = Object.keys(versionMeta.manifest);
  let downloaded = 0;

  for (const filePath of filePaths) {
    const url = `${JSR_BASE}/${version}${filePath}`;
    const res = await fetch(url, {
      headers: { Accept: "application/octet-stream" },
    });

    if (!res.ok) {
      throw new Error(`Failed to download ${filePath}: HTTP ${res.status}`);
    }

    const content = await res.text();
    const localPath = join(targetDir, filePath);
    const dir = dirname(localPath);

    if (!existsSync(dir)) {
      Deno.mkdirSync(dir, { recursive: true });
    }

    Deno.writeTextFileSync(localPath, content);
    downloaded++;
    onProgress?.(downloaded, filePaths.length);
  }
}

// ─── Local Helpers ──────────────────────────────────────────

function readKernelManifest(kernelDir: string): ModuleManifest | null {
  const manifestPath = join(kernelDir, MANIFEST_FILE);
  if (!existsSync(manifestPath)) return null;

  try {
    const manifest = JSON.parse(Deno.readTextFileSync(manifestPath)) as ModuleManifest;

    // Resolve version from deno.json
    if (!manifest.version) {
      const denoJsonPath = join(kernelDir, "deno.json");
      if (existsSync(denoJsonPath)) {
        try {
          const denoJson = JSON.parse(Deno.readTextFileSync(denoJsonPath));
          if (denoJson.version) manifest.version = denoJson.version;
        } catch { /* ignore */ }
      }
    }

    return manifest;
  } catch {
    return null;
  }
}

// ─── Install (Local) ─────────────────────────────────────────

/**
 * Install a local kernel directory by symlinking it to ~/.pons/kernel/.
 */
export async function installKernelLocal(localPath: string, force?: boolean): Promise<boolean> {
  const { resolve } = await import("@std/path");
  const ponsHome = getPonsHome();
  const kernelDir = join(ponsHome, KERNEL_DIR_NAME);
  const resolvedPath = resolve(localPath);

  // Verify the local path has a valid kernel
  const manifestPath = join(resolvedPath, MANIFEST_FILE);
  if (!existsSync(manifestPath)) {
    console.error(chalk.red(`  No module.json found at ${resolvedPath}`));
    console.error(chalk.dim("  Make sure the path points to a kernel directory."));
    return false;
  }

  const manifest = readKernelManifest(resolvedPath);
  if (!manifest) {
    console.error(chalk.red(`  Invalid module.json at ${resolvedPath}`));
    return false;
  }

  // Check existing
  if (existsSync(kernelDir)) {
    if (!force) {
      const existing = readKernelManifest(kernelDir);
      const reinstall = await clack.confirm({
        message: `Kernel ${existing ? `v${existing.version}` : ''} is already installed. Replace with local v${manifest.version}?`,
        initialValue: true,
      });
      if (clack.isCancel(reinstall) || !reinstall) {
        console.log(chalk.dim("  Keeping existing kernel."));
        return false;
      }
    }
    forceRemoveSync(kernelDir);
  }

  if (!existsSync(ponsHome)) {
    Deno.mkdirSync(ponsHome, { recursive: true });
  }

  // Create symlink
  Deno.symlinkSync(resolvedPath, kernelDir);

  console.log(
    chalk.green(`  Kernel v${manifest.version} linked from ${chalk.dim(resolvedPath)}`),
  );
  console.log(chalk.dim(`  → ${kernelDir}`));
  console.log();

  return true;
}

// ─── Install ────────────────────────────────────────────────

/**
 * Install the Pons kernel from JSR to ~/.pons/kernel/.
 */
export async function installKernel(home?: string, force?: boolean): Promise<boolean> {
  const ponsHome = home || getPonsHome();
  const kernelDir = join(ponsHome, KERNEL_DIR_NAME);

  const existingManifest = readKernelManifest(kernelDir);
  if (existingManifest) {
    if (!force) {
      const reinstall = await clack.confirm({
        message: `Kernel v${existingManifest.version} is already installed. Reinstall?`,
        initialValue: false,
      });

      if (clack.isCancel(reinstall) || !reinstall) {
        console.log(chalk.dim("  Keeping existing kernel installation."));
        return false;
      }
    }
    // Remove existing kernel before reinstall
    forceRemoveSync(kernelDir);
  }

  if (!existsSync(ponsHome)) {
    Deno.mkdirSync(ponsHome, { recursive: true });
  }

  const spinner = ora("Resolving latest kernel version...").start();

  try {
    const version = await fetchLatestVersion();
    spinner.text = `Fetching kernel v${version} file list...`;

    const versionMeta = await fetchVersionManifest(version);
    const fileCount = Object.keys(versionMeta.manifest).length;

    spinner.text = `Downloading kernel v${version} (${fileCount} files)...`;

    forceRemoveSync(kernelDir);
    Deno.mkdirSync(kernelDir, { recursive: true });

    await downloadPackageFiles(version, versionMeta, kernelDir, (current, total) => {
      spinner.text = `Downloading kernel v${version} (${current}/${total} files)...`;
    });

    const manifest = readKernelManifest(kernelDir);
    if (!manifest) {
      spinner.warn("Kernel downloaded but module.json not found in package.");
      return false;
    }

    spinner.succeed(
      `Kernel ${chalk.green(`v${manifest.version}`)} installed to ${chalk.dim(kernelDir)}`,
    );

    // Set up shell completions automatically
    setupCompletions();

    return true;
  } catch (error) {
    spinner.fail("Failed to install kernel");
    console.error(
      chalk.red(
        `  Error: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
    console.error(chalk.dim("  Check your network connection and try again."));

    forceRemoveSync(kernelDir);
    return false;
  }
}

// ─── Update ─────────────────────────────────────────────────

/**
 * Update the Pons kernel to the latest version from JSR.
 */
export async function updateKernel(home?: string, json?: boolean): Promise<boolean> {
  const ponsHome = home || getPonsHome();
  const kernelDir = join(ponsHome, KERNEL_DIR_NAME);

  const currentManifest = readKernelManifest(kernelDir);
  if (!currentManifest) {
    console.log(
      chalk.red(
        `  Kernel is not installed. Run ${chalk.bold("pons install")} first.`,
      ),
    );
    return false;
  }

  const spinner = ora(
    `Checking for updates (current: v${currentManifest.version})...`,
  ).start();

  try {
    const latestVersion = await fetchLatestVersion();

    if (json) {
      spinner.stop();
      const updated = latestVersion !== currentManifest.version;
      if (updated) {
        const versionMeta = await fetchVersionManifest(latestVersion);
        forceRemoveSync(kernelDir);
        Deno.mkdirSync(kernelDir, { recursive: true });
        await downloadPackageFiles(latestVersion, versionMeta, kernelDir);
      }
      console.log(JSON.stringify({
        component: "kernel",
        current: currentManifest.version,
        latest: latestVersion,
        updated,
      }));
      return true;
    }

    if (latestVersion === currentManifest.version) {
      spinner.succeed(
        `Kernel is already at the latest version (v${latestVersion}).`,
      );
      return true;
    }

    spinner.text = `Fetching kernel v${latestVersion} file list...`;
    const versionMeta = await fetchVersionManifest(latestVersion);
    const fileCount = Object.keys(versionMeta.manifest).length;

    spinner.text = `Downloading kernel v${latestVersion} (${fileCount} files)...`;

    // Replace kernel directory
    forceRemoveSync(kernelDir);
    Deno.mkdirSync(kernelDir, { recursive: true });

    await downloadPackageFiles(latestVersion, versionMeta, kernelDir, (current, total) => {
      spinner.text = `Downloading kernel v${latestVersion} (${current}/${total} files)...`;
    });

    const updatedManifest = readKernelManifest(kernelDir);
    if (!updatedManifest) {
      spinner.warn("Kernel updated but could not read manifest.");
      return true;
    }

    spinner.succeed(
      `Kernel updated: v${currentManifest.version} → ${chalk.green(`v${updatedManifest.version}`)}`,
    );

    console.log();
    console.log(
      chalk.yellow("  Restart the daemon for changes to take effect."),
    );
    console.log(chalk.dim("    pons kernel restart"));
    console.log();

    return true;
  } catch (error) {
    spinner.fail("Failed to update kernel");
    console.error(
      chalk.red(
        `  Error: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
    console.error(chalk.dim("  Check your network connection and try again."));
    return false;
  }
}

// ─── CLI Self-Update ────────────────────────────────────────

/**
 * Update the CLI itself via `deno install -g --force`.
 */
export async function updateCli(json?: boolean): Promise<boolean> {
  const spinner = ora("Checking for CLI updates...").start();

  try {
    // Fetch latest CLI version from JSR
    const res = await fetch("https://jsr.io/@pons/cli/meta.json", {
      headers: { Accept: "application/json" },
    });

    if (!res.ok) {
      spinner.fail("Failed to check CLI version");
      return false;
    }

    const meta = (await res.json()) as { latest: string };
    const latestVersion = meta.latest;

    const currentVersion = CLI_VERSION;

    if (json) {
      spinner.stop();
      const updated = latestVersion !== currentVersion;
      if (updated) {
        new Deno.Command("deno", {
          args: ["install", "-g", "-A", "--force", "-n", "pons", `jsr:@pons/cli@${latestVersion}`],
          stdout: "null",
          stderr: "null",
        }).outputSync();
      }
      console.log(JSON.stringify({
        component: "cli",
        current: currentVersion,
        latest: latestVersion,
        updated,
      }));
      return true;
    }

    if (latestVersion === currentVersion) {
      spinner.succeed(
        `CLI is already at the latest version (v${latestVersion}).`,
      );
      return true;
    }

    spinner.text = `Updating CLI: v${currentVersion} → v${latestVersion}...`;

    new Deno.Command("deno", {
      args: ["install", "-g", "-A", "--force", "-n", "pons", `jsr:@pons/cli@${latestVersion}`],
      stdout: "null",
      stderr: "null",
    }).outputSync();

    spinner.succeed(
      `CLI updated: v${currentVersion} → ${chalk.green(`v${latestVersion}`)}`,
    );
    return true;
  } catch (error) {
    spinner.fail("Failed to update CLI");
    console.error(
      chalk.red(
        `  Error: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
    console.error(chalk.dim("  Check your network connection and try again."));
    return false;
  }
}

// ─── Delete ─────────────────────────────────────────────────

/**
 * Stop the kernel daemon if it's running.
 * Reads the PID from ~/.pons/.runtime/kernel.pid and sends SIGTERM,
 * waiting up to 5 seconds for graceful shutdown, then SIGKILL if needed.
 */
async function stopKernelDaemon(ponsHome: string): Promise<void> {
  const pidFilePath = join(ponsHome, ".runtime", "kernel.pid");

  if (!existsSync(pidFilePath)) {
    return; // PID file doesn't exist, daemon not running
  }

  try {
    const pidContent = Deno.readTextFileSync(pidFilePath);
    const pid = parseInt(pidContent.trim(), 10);

    if (isNaN(pid)) {
      return; // Invalid PID, skip
    }

    // Try to send SIGTERM for graceful shutdown
    try {
      Deno.kill(pid, "SIGTERM");
    } catch (e) {
      if (e instanceof Deno.errors.NotFound) {
        // Process doesn't exist, remove the PID file
        forceRemoveSync(pidFilePath);
        return;
      }
      throw e;
    }

    // Poll for up to 5 seconds to see if process exits gracefully
    const startTime = Date.now();
    const timeout = 5000; // 5 seconds
    let exited = false;

    while (Date.now() - startTime < timeout) {
      try {
        Deno.kill(pid, 0); // Signal 0 checks if process exists
      } catch (e) {
        if (e instanceof Deno.errors.NotFound) {
          exited = true;
          break;
        }
        throw e;
      }
      await new Promise((resolve) => setTimeout(resolve, 100)); // Sleep 100ms
    }

    // If still running, force kill
    if (!exited) {
      try {
        Deno.kill(pid, "SIGKILL");
      } catch (e) {
        if (!(e instanceof Deno.errors.NotFound)) {
          throw e;
        }
      }
    }

    // Remove the PID file
    forceRemoveSync(pidFilePath);
  } catch (error) {
    // If we can't read or process the PID file, just continue
    // The kernel dir removal might fail anyway if the process is holding locks
  }
}

/**
 * Delete the Pons kernel and optionally all Pons data.
 */
export async function deleteKernel(home?: string): Promise<boolean> {
  const ponsHome = home || getPonsHome();
  const kernelDir = join(ponsHome, KERNEL_DIR_NAME);

  if (!existsSync(kernelDir)) {
    console.log(chalk.red("  Kernel is not installed. Nothing to delete."));
    return false;
  }

  // Stop daemon if running
  await stopKernelDaemon(ponsHome);

  const spinner = ora("Removing kernel...").start();

  try {
    Deno.removeSync(kernelDir, { recursive: true });
    spinner.succeed(`Kernel removed from ${chalk.dim(kernelDir)}`);
  } catch (error) {
    spinner.fail("Failed to remove kernel");
    console.error(
      chalk.red(
        `  Error: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
    return false;
  }

  const removeAll = await clack.confirm({
    message: `Also remove ALL Pons data at ${ponsHome}?`,
    initialValue: false,
  });

  if (clack.isCancel(removeAll) || !removeAll) {
    console.log(chalk.dim("  Keeping Pons data directory."));
    return true;
  }

  const cleanupSpinner = ora(
    `Removing ${chalk.dim(ponsHome)}...`,
  ).start();

  try {
    Deno.removeSync(ponsHome, { recursive: true });
    cleanupSpinner.succeed(
      `All Pons data removed from ${chalk.dim(ponsHome)}`,
    );
  } catch (error) {
    cleanupSpinner.fail("Failed to remove Pons data directory");
    console.error(
      chalk.red(
        `  Error: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
    return false;
  }

  return true;
}
