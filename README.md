# claude-mods

Personal Claude Code mods, published as a plugin marketplace.

## Mods

### orchestrator-band

A tracker for orchestrated work. It sits on one row above the prompt and grows upward.

- **Row:** `◐ 2 running · 2/6 ⌃` on the left. On the right, `124k │ 5h 23% │ ↻ 2h14m` (context tokens, 5-hour limit, time to reset), in monospace with fixed-width numbers.
- **Peek (default):** the running agents, each with its task, latest action, elapsed time and a stop button, then the next pending task.
- **Expanded:** the full task list, with agents under the tasks they work on, capped at 40% of the window. **Pin to side** moves it into a side pane; `/tracker` toggles the pane.
- **Cache countdown:** `◷ cache 38:12` under the main thread's last reply.

Tasks come from the desktop app's task list, `TodoWrite`, and `TaskCreate`/`TaskUpdate`. Agents come from the subagents the session spawns.

## Install

At the prompt of a terminal session:

```
/plugin install orchestrator-band --marketplace nhanhuynh296/claude-mods
```

From a shell:

```bash
claude plugin install orchestrator-band --marketplace nhanhuynh296/claude-mods
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `nhanhuynh296/claude-mods`, then Add plugin.

This repository is private. Installing needs read access on GitHub and a git credential for github.com on the machine (an SSH key, or `gh auth login` then `gh auth setup-git`).

## Develop

```bash
claude plugin validate mods/orchestrator-band
```

```bash
claude plugin test mods/orchestrator-band
```
