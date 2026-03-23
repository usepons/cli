/**
 * Shell completion scripts for the Pons CLI.
 *
 * Supports bash, zsh, and fish. Completions are generated dynamically
 * by introspecting Commander's registered command tree.
 */

import type { Command } from "commander";
import { join } from "@std/path";
import { existsSync } from "@std/fs";
import chalk from "chalk";

const encoder = new TextEncoder();

// ─── Generators ──────────────────────────────────────────────

function generateBash(program: Command): string {
  const cmds = collectCommands(program);

  return `# Pons CLI bash completion
# Add to ~/.bashrc:  eval "$(pons completion bash)"

_pons_completions() {
  local cur prev words cword
  _init_completion || return

  local toplevel="${cmds.top.join(" ")}"
${cmds.subs.map(([parent, children]) =>
    `  local ${parent}_cmds="${children.join(" ")}"`
  ).join("\n")}

  case "\${words[1]}" in
${cmds.subs.map(([parent, children]) =>
    `    ${parent})
      COMPREPLY=( $(compgen -W "${children.join(" ")}" -- "$cur") )
      return ;;`
  ).join("\n")}
  esac

  if [[ $cword -eq 1 ]]; then
    COMPREPLY=( $(compgen -W "$toplevel" -- "$cur") )
  fi
}

complete -F _pons_completions pons
`;
}

function generateZsh(program: Command): string {
  const cmds = collectCommands(program);

  return `#compdef pons
# Pons CLI zsh completion
# Add to ~/.zshrc:  eval "$(pons completion zsh)"

_pons() {
  local -a toplevel
  toplevel=(
${cmds.top.map(c => `    '${c}:${cmds.descs.get(c) || ""}'`).join("\n")}
  )

  _arguments -C \\
    '1:command:->cmd' \\
    '*::arg:->args'

  case $state in
    cmd)
      _describe 'command' toplevel
      ;;
    args)
      case $words[1] in
${cmds.subs.map(([parent, children]) => {
    const subDescs = children.map(c => `          '${c}:${cmds.descs.get(`${parent}.${c}`) || ""}'`).join("\n");
    return `        ${parent})
          local -a subcmds
          subcmds=(
${subDescs}
          )
          _describe 'subcommand' subcmds
          ;;`;
  }).join("\n")}
      esac
      ;;
  esac
}

_pons "$@"
`;
}

function generateFish(program: Command): string {
  const cmds = collectCommands(program);

  let script = `# Pons CLI fish completion
# Add to ~/.config/fish/completions/pons.fish or run:
#   pons completion fish > ~/.config/fish/completions/pons.fish

# Disable file completions
complete -c pons -f

# Top-level commands
`;

  for (const c of cmds.top) {
    const desc = cmds.descs.get(c) || "";
    script += `complete -c pons -n "__fish_use_subcommand" -a "${c}" -d "${desc}"\n`;
  }

  for (const [parent, children] of cmds.subs) {
    script += `\n# ${parent} subcommands\n`;
    for (const c of children) {
      const desc = cmds.descs.get(`${parent}.${c}`) || "";
      script += `complete -c pons -n "__fish_seen_subcommand_from ${parent}" -a "${c}" -d "${desc}"\n`;
    }
  }

  return script;
}

// ─── Helpers ─────────────────────────────────────────────────

interface CommandTree {
  top: string[];
  subs: [string, string[]][];
  descs: Map<string, string>;
}

function collectCommands(program: Command): CommandTree {
  const top: string[] = [];
  const subs: [string, string[]][] = [];
  const descs = new Map<string, string>();

  for (const cmd of program.commands) {
    const name = cmd.name();
    top.push(name);
    descs.set(name, cmd.description());

    const children = cmd.commands;
    if (children.length > 0) {
      const childNames: string[] = [];
      for (const sub of children) {
        const subName = sub.name();
        childNames.push(subName);
        descs.set(`${name}.${subName}`, sub.description());
      }
      subs.push([name, childNames]);
    }
  }

  return { top, subs, descs };
}

// ─── Registration ────────────────────────────────────────────

export function registerCompletionCommand(program: Command): void {
  program
    .command("completion")
    .description("Generate shell completion scripts (bash, zsh, fish)")
    .argument("[shell]", "Shell type: bash, zsh, or fish", "zsh")
    .addHelpText("after", "\nExamples:\n  $ pons completion bash\n  $ pons completion zsh > ~/.zsh_completions")
    .action((shell: string) => {
      switch (shell) {
        case "bash":
          Deno.stdout.writeSync(encoder.encode(generateBash(program)));
          break;
        case "zsh":
          Deno.stdout.writeSync(encoder.encode(generateZsh(program)));
          break;
        case "fish":
          Deno.stdout.writeSync(encoder.encode(generateFish(program)));
          break;
        default:
          console.error(`Unknown shell: ${shell}. Supported: bash, zsh, fish`);
      }
    });
}

// ─── Auto-setup ──────────────────────────────────────────────

const COMPLETION_MARKER = "# pons shell completion";
const EVAL_LINE_ZSH = `${COMPLETION_MARKER}\neval "$(pons completion zsh)"`;
const EVAL_LINE_BASH = `${COMPLETION_MARKER}\neval "$(pons completion bash)"`;

/**
 * Detect the user's shell and install completions automatically.
 * Returns true if completions were set up, false if skipped or failed.
 */
export function setupCompletions(): boolean {
  const shell = detectShell();

  try {
    switch (shell) {
      case "zsh":
        return installToRcFile(join(homeDir(), ".zshrc"), EVAL_LINE_ZSH, "zsh");
      case "bash":
        return installToRcFile(
          join(homeDir(), existsSync(join(homeDir(), ".bash_profile")) ? ".bash_profile" : ".bashrc"),
          EVAL_LINE_BASH,
          "bash",
        );
      case "fish":
        return installFishCompletion();
      default:
        console.log(chalk.dim("  Could not detect shell. Run `pons completion --help` to set up manually."));
        return false;
    }
  } catch {
    console.log(chalk.dim("  Could not set up completions automatically. Run `pons completion --help` to set up manually."));
    return false;
  }
}

function detectShell(): string | null {
  const shell = Deno.env.get("SHELL") || "";
  if (shell.includes("zsh")) return "zsh";
  if (shell.includes("bash")) return "bash";
  if (shell.includes("fish")) return "fish";
  return null;
}

function homeDir(): string {
  return Deno.env.get("HOME") || Deno.env.get("USERPROFILE") || "~";
}

function installToRcFile(rcPath: string, evalLine: string, shellName: string): boolean {
  // Check if already installed
  if (existsSync(rcPath)) {
    const content = Deno.readTextFileSync(rcPath);
    if (content.includes(COMPLETION_MARKER)) {
      return true; // already set up
    }
  }

  Deno.writeTextFileSync(rcPath, `\n${evalLine}\n`, { append: true });
  console.log(chalk.green(`  Shell completions added to ${chalk.dim(rcPath)}`));
  console.log(chalk.dim(`  Restart your ${shellName} session or run: source ${rcPath}`));
  return true;
}

function installFishCompletion(): boolean {
  const completionsDir = join(homeDir(), ".config", "fish", "completions");
  const completionFile = join(completionsDir, "pons.fish");

  if (existsSync(completionFile)) {
    const content = Deno.readTextFileSync(completionFile);
    if (content.includes("Pons CLI fish completion")) {
      return true; // already set up
    }
  }

  // For fish we write a stub that calls `pons completion fish` at load time
  if (!existsSync(completionsDir)) {
    Deno.mkdirSync(completionsDir, { recursive: true });
  }

  Deno.writeTextFileSync(
    completionFile,
    `# pons shell completion — auto-generated\npons completion fish | source\n`,
  );
  console.log(chalk.green(`  Fish completions written to ${chalk.dim(completionFile)}`));
  return true;
}
