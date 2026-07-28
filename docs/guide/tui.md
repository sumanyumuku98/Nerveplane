# Terminal UI

Nerveplane's terminal experience has two interactive pieces on top of the plain commands: **selection prompts** (so you don't have to memorize flags) and a **live full-screen monitor**. Both are additive — on a non-TTY (pipes, scripts, CI) the CLI keeps its exact plain-text behavior, and every flag still works.

## Interactive pickers

Where a command needs a choice you'd otherwise pass as a flag, running it on a terminal now prompts:

```bash
nerveplane worker        # no --agent? → pick claude / codex / opencode (with install + MCP status)
nerveplane install       # no target?  → pick which CLI to wire up
nerveplane conflicts     # open conflicts? → pick one, then resolve / dismiss
```

Pass the flag to skip the prompt (unchanged): `nerveplane worker --agent codex`, `nerveplane install codex`, `nerveplane conflicts resolve <id>`. `--print` never prompts.

## Live monitor — `nerveplane watch`

A full-screen terminal dashboard of the whole coordination plane — the same data as the web dashboard, without leaving the terminal:

```bash
nerveplane watch          # full-screen live monitor (alias: nerveplane monitor)
nerveplane watch --once   # print one snapshot and exit (scriptable / non-TTY)
```

Panes: **Agents** (status · name · branch · last-seen), **Open conflicts** (selectable), **Events** timeline, and the **Chat** feed. It subscribes to the daemon's live SSE stream, so panes update in real time as agents register, conflicts open, and messages fly — no polling, no refresh key.

**Keys:** `q` / `Ctrl-C` quit · `↑`/`↓` or `j`/`k` select a conflict · `r` resolve · `d` dismiss the selected conflict · `?` toggle help.

The monitor uses a hand-rolled ANSI renderer (no native dependencies), so it ships inside the single-file standalone binaries just like the rest of the CLI. Color is automatically disabled when output isn't a TTY or `NO_COLOR` is set.
