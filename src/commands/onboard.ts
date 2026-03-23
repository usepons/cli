/**
 * pons onboard — First-time setup wizard
 *
 * Guides the user through initial configuration:
 *   - LLM provider selection + API key
 *   - Module selection from remote registry
 *   - Directory structure creation
 *   - Config + agent generation
 *   - Module installation
 */

import type { Command } from "commander";
import { join, resolve, toFileUrl } from "@std/path";
import { existsSync } from "@std/fs";
import * as clack from "@clack/prompts";
import { getPonsHome } from "@pons/sdk";
import { fetchRegistry, groupByCategory } from "../registry.ts";
import type { RegistryModule } from "../registry.ts";

/**
 * Dynamically import the module installer from the kernel.
 * The kernel must be installed at ~/.pons/kernel/ for this to work.
 */
async function getModuleInstaller(
  home: string,
): Promise<(nameOrUrl: string, ponsHome?: string) => Promise<boolean>> {
  const installerPath = resolve(home, "kernel", "src", "modules", "installer.ts");
  // Resolve symlinks so Deno uses the correct import map context
  const realPath = Deno.realPathSync(installerPath);
  const mod = await import(toFileUrl(realPath).href);
  return mod.installModule;
}

// ─── Constants ──────────────────────────────────────────────

const MODEL_DEFAULTS: Record<string, string> = {
  anthropic: "claude-sonnet-4-20250514",
  openai: "gpt-4o",
  ollama: "llama3",
  google: "gemini-2.0-flash",
};

const API_KEY_ENV_VARS: Record<string, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  google: "GEMINI_API_KEY",
};

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
  ollama: "Ollama",
  none: "None",
};

const DEFAULT_AGENT_MD = `# Default Agent

You are a helpful AI assistant.

## Personality
- Friendly and professional
- Clear and concise
- Helpful and proactive

## Guidelines
- Answer questions accurately
- Ask for clarification when needed
- Be honest about limitations
`;

const DIRS = [
  "workspace",
  "workspace/sessions",
  "workspace/memory",
  "workspace/sandboxes",
  "workspace/artifacts",
  "agents",
  "agents/default",
  "skills",
  "modules",
  ".runtime",
  "data/memory",
  "data/identity",
];

// ─── Helpers ────────────────────────────────────────────────

function handleCancel(): never {
  clack.cancel("Onboarding cancelled.");
  Deno.exit(0);
}

function buildConfigYaml(provider: string): string {
  const defaultModel = MODEL_DEFAULTS[provider] || "claude-sonnet-4-20250514";
  const providerValue = provider === "none" ? "anthropic" : provider;

  return [
    "# Pons Configuration",
    "",
    "gateway:",
    "  httpPort: 18790",
    "  wsPort: 18790",
    "  auth:",
    "    enabled: false",
    "",
    "models:",
    `  default: ${defaultModel}`,
    `  provider: ${providerValue}`,
    "",
    "logging:",
    "  level: info",
    "",
  ].join("\n");
}

function buildGroupedOptions(
  modules: RegistryModule[],
): Record<string, Array<{ value: string; label: string; hint?: string }>> {
  const grouped = groupByCategory(modules);
  const options: Record<
    string,
    Array<{ value: string; label: string; hint?: string }>
  > = {};

  for (const [category, mods] of Object.entries(grouped)) {
    options[category] = mods.map((m) => ({
      value: m.id,
      label: m.name,
      hint: m.description,
    }));
  }

  return options;
}

// ─── Command Registration ───────────────────────────────────

export function registerOnboardCommand(program: Command): void {
  program
    .command("onboard")
    .description("Interactive setup — configure provider, install modules")
    .option("--home <path>", "Override PONS_HOME directory")
    .addHelpText("after", "\nExamples:\n  $ pons onboard\n  $ pons onboard --home ~/custom")
    .action(async (opts) => {
      const home = opts.home || getPonsHome();
      const configFile = join(home, "config.yaml");

      // ── Guard: kernel must be installed ──────────────────
      if (!existsSync(resolve(home, "kernel", "module.json"))) {
        clack.log.error(
          "Kernel is not installed. Run `pons install` first.",
        );
        return;
      }

      // ── Guard: already initialised ──────────────────────
      if (existsSync(configFile)) {
        clack.log.error(
          `Pons is already configured at ${home}.\n` +
            `  Remove ${configFile} to re-run onboarding.`,
        );
        return;
      }

      // ── Welcome ─────────────────────────────────────────
      clack.intro("Welcome to Pons");

      // ── Provider selection ──────────────────────────────
      const provider = await clack.select({
        message: "Which LLM provider would you like to use?",
        options: [
          {
            value: "anthropic",
            label: "Anthropic (Claude)",
            hint: "recommended",
          },
          { value: "openai", label: "OpenAI" },
          { value: "google", label: "Google (Gemini)" },
          { value: "ollama", label: "Ollama (local)" },
          { value: "none", label: "Skip for now" },
        ],
      });

      if (clack.isCancel(provider)) handleCancel();

      // ── API key ─────────────────────────────────────────
      let apiKey: string | undefined;
      if (provider !== "none" && provider !== "ollama") {
        const key = await clack.password({
          message: `Enter your ${PROVIDER_LABELS[provider]} API key:`,
          mask: "*",
        });

        if (clack.isCancel(key)) handleCancel();
        apiKey = key;
      }

      // ── Fetch registry ────────────────────────────────
      const registrySpinner = clack.spinner();
      registrySpinner.start("Fetching module registry...");

      const registry = await fetchRegistry();

      let selectedModules: string[] = [];

      if (!registry) {
        registrySpinner.stop("Could not fetch module registry");
        clack.log.warn(
          "Module registry is unavailable. You can install modules later with `pons install`.",
        );
      } else {
        registrySpinner.stop("Module registry loaded");

        // ── Module selection ────────────────────────────
        const essentialIds = registry
          .filter((m) => m.essential)
          .map((m) => m.id);

        const grouped = buildGroupedOptions(registry);

        const modules = await clack.groupMultiselect({
          message: "Select modules to install",
          options: grouped,
          initialValues: essentialIds,
        });

        if (clack.isCancel(modules)) handleCancel();
        selectedModules = modules as string[];
      }

      // ── Summary + Confirm ─────────────────────────────
      const model = MODEL_DEFAULTS[provider] || "claude-sonnet-4-20250514";
      const summaryLines = [
        `Provider:  ${PROVIDER_LABELS[provider]}`,
        `Model:     ${model}`,
        `Home:      ${home}`,
        `Modules:   ${selectedModules.length} selected`,
      ];

      clack.note(summaryLines.join("\n"), "Setup Summary");

      const proceed = await clack.confirm({
        message: "Proceed with setup?",
      });

      if (clack.isCancel(proceed) || !proceed) handleCancel();

      // ── Scaffold ──────────────────────────────────────
      const scaffold = clack.spinner();
      scaffold.start("Creating directory structure...");

      for (const dir of DIRS) {
        Deno.mkdirSync(join(home, dir), { recursive: true });
      }

      scaffold.stop("Directory structure created");

      // ── Write config.yaml ─────────────────────────────
      Deno.writeTextFileSync(
        join(home, "config.yaml"),
        buildConfigYaml(provider),
      );
      clack.log.success("Wrote config.yaml");

      // ── Write .env ────────────────────────────────────
      if (apiKey) {
        const envVarName = API_KEY_ENV_VARS[provider];
        if (envVarName) {
          const envContent =
            `# Pons environment\n# Generated by: pons onboard\n\n${envVarName}=${apiKey}\n`;
          Deno.writeTextFileSync(join(home, ".env"), envContent);
          clack.log.success(`Wrote .env with ${envVarName}`);
        }
      }

      // ── Write AGENT.md ────────────────────────────────
      Deno.writeTextFileSync(
        join(home, "agents", "default", "AGENT.md"),
        DEFAULT_AGENT_MD,
      );
      clack.log.success("Created default agent");

      // ── Install modules ───────────────────────────────
      if (selectedModules.length > 0) {
        const installModule = await getModuleInstaller(home);
        const failures: string[] = [];

        for (const mod of selectedModules) {
          const s = clack.spinner();
          s.start(`Installing ${mod}...`);

          const ok = await installModule(mod, home);

          if (ok) {
            s.stop(`Installed ${mod}`);
          } else {
            s.stop(`Failed to install ${mod}`);
            failures.push(mod);
          }
        }

        if (failures.length > 0) {
          clack.log.warn(
            `Some modules failed to install: ${failures.join(", ")}\n` +
              "  You can retry with `pons modules install <module>`.",
          );
        }
      }

      // ── Done ──────────────────────────────────────────
      clack.note(
        [
          "pons kernel start -d  Start the kernel (background)",
          "pons kernel start     Start the kernel (foreground)",
          "pons kernel status    Check kernel status",
          "pons install <mod>    Install more modules",
        ].join("\n"),
        "Next steps",
      );

      clack.outro("Pons is ready!");
    });
}
