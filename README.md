# claude-orchestration skill

A Claude Code skill that orchestrates **Gemini DEV + Gemini QA** agents through a TDD workflow with Trello integration.

Claude acts as team lead: reads Trello cards, builds a TDD checklist, drives Gemini agents through RED→GREEN→REFACTOR cycles, verifies commits, and manages context budget automatically.

## What it does

- Auto-starts two `gemini --yolo` agents in tmux sessions (`gemini-dev`, `gemini-qa`)
- Reads Trello card (via DEV agent) — including Google Sheets design docs attached to the card
- Proposes TDD checklist, waits for confirmation, creates it on the Trello card
- Drives the RED→GREEN→REFACTOR loop autonomously
- Verifies every commit via `git diff` (Claude reads diffs directly — never trusts agent self-report)
- Manages context budget: saves state + hands off cleanly when context hits 70%
- Resumes from handoff across `/clear` or session crashes

## Requirements

- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code)
- [Gemini CLI](https://github.com/google-gemini/gemini-cli) (`gemini --yolo` must work in your terminal)
- [ai-devkit](https://github.com/google-gemini/gemini-cli) — the `agent` CLI command must be on your PATH
- `tmux` installed
- Trello API key + token in environment: `TRELLO_API_KEY`, `TRELLO_TOKEN`

## Customization before use

This skill was built for the FMI project. Before using on another project, edit these parts of `orchestration-workflow.md`:

| Location | FMI-specific thing | Replace with |
|---|---|---|
| Step 2, `activate_skill` calls | `activate_skill('fmi-codebase')` | Your project's domain skill, or remove these lines |
| CLI Reference section | `node ~/FMI/test-agent-orchestration/ai-devkit/packages/cli/dist/cli.js` | Your `agent` CLI path, or just `agent` if it's on PATH |
| Pre-flight task template | `node ~/FMI/test-agent-orchestration/ai-devkit/...` memory search path | Your ai-devkit path |
| Resume/handoff messages | Vietnamese text (`Tìm thấy session...`) | Your preferred language |

## Installation

```bash
# Clone the repo
git clone <this-repo-url> /tmp/claude-orchestration-skill

# Copy to Claude Code skills directory
mkdir -p ~/.claude/skills/claude-orchestration
cp -r /tmp/claude-orchestration-skill/SKILL.md \
       /tmp/claude-orchestration-skill/orchestration-workflow.md \
       /tmp/claude-orchestration-skill/agents \
       ~/.claude/skills/claude-orchestration/
```

Restart Claude Code, then use:

```
/claude-orchestration
```

Or say: "start orchestration" / "bắt đầu orchestrate"

## How it works

1. **Fresh start**: Claude auto-starts two Gemini agents in tmux, asks you for a Trello card link
2. **Pre-flight**: DEV agent reads Trello card + any attached Google Sheets design docs
3. **TDD loop**: QA writes failing test → DEV implements → Claude verifies commit → repeat
4. **Code review**: Claude reads full diff, sends targeted refactor instructions
5. **Regression**: QA runs full test suite
6. **Squash**: DEV squashes micro-commits into 2-3 semantic commits
7. **Done**: DEV ticks Trello items, comments summary on card

## State files (written to your project's `.claude/` dir)

- `orchestration-state.json` — ground truth for agent names, task progress, checklist
- `orchestration-handoff.md` — human-readable summary for the current state
- `orchestration-prompt-log.jsonl` — log of every prompt sent to agents with outcomes

## Loop architecture

```
REPEAT until done:
  0. CHECK   — anti-patterns gate (state valid? tmux sessions alive?)
  0b. BUDGET — stop at 70% context, save handoff
  1. LOAD    — read state file
  2. SCAN    — agent list --json (filter by project)
  3. ASSESS  — agent detail --tail 3 (only on status change)
  4. ACT     — send instructions
  5. SAVE    — write state + handoff
  6. REPORT  — one-line status to user
  7. WATCH   — launch background watcher, stop (don't poll)
```
