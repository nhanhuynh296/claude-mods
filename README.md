# claude-mods

Personal Claude Code mods, published as a plugin marketplace.

## Mods

### usage-row

One row above the prompt, right-aligned, in monospace with fixed-width numbers so nothing shifts as values count down:

`124k │ 5h 23% │ ↻ 2h14m`: context tokens, the 5-hour limit (amber from 75%, red from 90%), and time until it resets.

Under the main thread's last reply it adds `◷ cache 38:12`, the prompt cache's countdown (amber under 5 minutes).

## Install

At the prompt of a terminal session:

```
/plugin install usage-row --marketplace nhanhuynh296/claude-mods
```

From a shell:

```bash
claude plugin install usage-row --marketplace nhanhuynh296/claude-mods
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `nhanhuynh296/claude-mods`, then Add plugin.

This repository is private. Installing needs read access on GitHub and a git credential for github.com on the machine (an SSH key, or `gh auth login` then `gh auth setup-git`).

## Develop

```bash
claude plugin validate mods/usage-row
```

```bash
claude plugin test mods/usage-row
```

Bump `version` in the mod's `.claude-plugin/plugin.json` before pushing, then `claude plugin update usage-row@claude-mods` and `/reload-plugins`.
