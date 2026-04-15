# Gemini Hooks — Installation & Usage

These hooks plug into Gemini CLI's hook system to enforce output format and file-scope rules
without requiring Claude to manually verify and send correction loops.

## Hooks included

### `after-agent-format-check.js` (AfterAgent)
Validates every Gemini response. If the response doesn't start with `DONE |` or `NOT_DONE |`,
Gemini is told to retry using the correct format. Eliminates 80%+ of Claude's correction round-trips.

**Expected formats:**
```
DONE | files: src/x.py, src/y.py | tests: 5/5 pass | git: abc123 def456 | deleted_logic: none | notes: -
NOT_DONE | reason: <why stuck>
```

### `before-tool-scope-guard.js` (BeforeTool)
Blocks `write_file` and `replace` calls based on role:
- `GEMINI_ROLE=DEV` → cannot write test files
- `GEMINI_ROLE=QA` → can only write test files
- `ALLOWED_PATHS=/path1:/path2` → whitelist specific path prefixes

---

## Installation

### Option 1 — Per-project (recommended)
Copy `hooks.json` to your project's `.gemini/` directory:
```bash
mkdir -p /path/to/your/project/.gemini
cp hooks.json /path/to/your/project/.gemini/hooks.json
```
Update `command` paths in `hooks.json` to match where you installed the hook scripts.

### Option 2 — Global
Copy `hooks.json` to `~/.gemini/hooks.json`.
This applies to all Gemini sessions.

---

## Starting Gemini with role env var

```bash
# DEV agent — can't touch test files
GEMINI_ROLE=DEV gemini --yolo

# QA agent — can only touch test files
GEMINI_ROLE=QA gemini --yolo

# With explicit path whitelist
GEMINI_ROLE=DEV ALLOWED_PATHS=/path/to/project/src gemini --yolo
```

Or in tmux (as used by the orchestration skill):
```bash
tmux new-session -d -s gemini-dev -e GEMINI_ROLE=DEV "gemini --yolo"
tmux new-session -d -s gemini-qa  -e GEMINI_ROLE=QA  "gemini --yolo"
```

---

## How the AfterAgent retry works

Gemini's hook system:
1. Gemini finishes a response → `AfterAgent` fires
2. Hook receives `{ prompt_response: "...", stop_hook_active: false }`
3. If format is wrong: hook returns `{ continue: false, systemMessage: "..." }`
4. Gemini sees the systemMessage and retries with correct format
5. On retry: `stop_hook_active: true` → hook allows through (prevents infinite loop)

---

## Behavior tested (from gemini-cli-findings.md)

- `[CONSTRAINT]` in prompts: works for file-level scope
- `/compress` between tasks: safe, retains functional context
- `AfterAgent` hook: confirmed in schema — `continue: false` stops agent loop and triggers retry
- `stop_hook_active`: set to `true` on retry pass, prevents infinite loop

---

## Schema reference (extracted from Gemini CLI source)

**AfterAgent hook input:**
```json
{
  "event": "AfterAgent",
  "prompt": "original user prompt",
  "prompt_response": "Gemini's response text",
  "stop_hook_active": false
}
```

**Hook output:**
```json
{
  "continue": false,
  "systemMessage": "message shown in terminal",
  "hookSpecificOutput": {
    "clearContext": false
  }
}
```

**BeforeTool hook input:**
```json
{
  "event": "BeforeTool",
  "tool_name": "write_file",
  "tool_input": { "path": "/some/file.py", "content": "..." }
}
```

**BeforeTool hook output:**
```json
{
  "decision": "allow",
  "reason": "optional explanation"
}
```
