# @pons/cli

Command-line interface for the Pons modular AI gateway.

## Installation

```bash
deno install -g -A jsr:@pons/cli
```

Verify:

```bash
pons --version
```

## Quick Start

```bash
# Install the kernel
pons install

# Run the setup wizard
pons onboard
```

After onboarding, start the kernel:

```bash
pons kernel start
```

## Commands

| Command | Description |
|---------|-------------|
| `pons install` | Install the Pons kernel to `~/.pons/` |
| `pons update` | Update CLI and kernel to latest versions |
| `pons delete` | Remove kernel and optionally all Pons data |
| `pons onboard` | Interactive setup — configure provider, install modules |
| `pons completion` | Generate shell completion scripts (bash, zsh, fish) |

Additional commands are loaded dynamically from the kernel and installed modules. Run `pons --help` to see all available commands.

### pons install

```bash
pons install           # Install kernel (prompts if already installed)
pons install --force   # Reinstall without prompting
```

### pons update

```bash
pons update            # Update both CLI and kernel
pons update --json     # JSON output for CI/scripts
```

### pons onboard

```bash
pons onboard                   # Interactive setup wizard
pons onboard --home ~/custom   # Use custom home directory
```

### pons completion

```bash
pons completion bash   # Output bash completions
pons completion zsh    # Output zsh completions
pons completion fish   # Output fish completions
```

Completions are set up automatically during `pons install`. To set up manually:

```bash
# Zsh (add to ~/.zshrc)
eval "$(pons completion zsh)"

# Bash (add to ~/.bashrc)
eval "$(pons completion bash)"

# Fish
pons completion fish > ~/.config/fish/completions/pons.fish
```

## Configuration

Pons stores all data in `~/.pons/` (override with `PONS_HOME`):

```
~/.pons/
├── kernel/          # Kernel installation
├── modules/         # Installed modules
├── agents/          # Agent definitions
├── skills/          # Custom skills
├── workspace/       # Sessions, memory, artifacts
├── config.yaml      # Main configuration
└── .env             # API keys
```

## Development

```bash
# Clone and run locally
deno task dev

# Run with arguments
deno task dev install
deno task dev --help
```

## License

MIT
