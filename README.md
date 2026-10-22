# claude-mods

Personal Claude Code mods, published as a plugin marketplace.

## Mods

### usage-row

One row above the prompt, in monospace with fixed-width numbers so nothing shifts as values count down.

Left: `◔ 23% 228k/1M │ 5h 5% │ ↻ 3h36m`: a ring and percent for the chat's context window (an SVG ring on desktop, `○◔◑◕●` on the terminal), its tokens of the window, the 5-hour limit, and time until it resets. Levels are green, amber from 75%, red from 90%. Text uses the app's theme colors, so contrast holds in light and dark.

Right, while background work runs: `◉ 3 npm run dev +2`: the count, the first task's name, and how many more. Shells, monitors and workflows show when they start and leave when their notification says they ended; subagents update every second.

When a tip shows above it (Claude Code's built-in tips), the tip and the row draw as two bordered cards; with no tip the row takes no border rows.

Under the main thread's last reply it adds a monospace line, `󰚭 cache 38:12`: the prompt cache's countdown (`· expiring` under 5 minutes, `cold` once expired). The glyph is Nerd Font `md-timer_sand_empty`; a font without Nerd Font symbols draws it as a box. It follows a rewind to the reply that is then last.

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
