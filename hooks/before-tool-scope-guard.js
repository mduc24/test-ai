#!/usr/bin/env node
/**
 * BeforeTool hook — blocks write_file / replace calls outside the allowed scope.
 *
 * Reads ALLOWED_PATHS from env (colon-separated list of path prefixes).
 * If not set, falls back to blocking writes to test files when role is DEV,
 * and blocking writes to non-test files when role is QA.
 *
 * Hook input (stdin JSON):
 *   { event: "BeforeTool", tool_name: string, tool_input: object }
 *
 * Hook output (stdout JSON):
 *   { decision: "allow" | "deny", reason: string }
 */

const input = JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf8'));

const WRITE_TOOLS = new Set(['write_file', 'replace']);
const toolName = input.tool_name || '';

// Only inspect write operations
if (!WRITE_TOOLS.has(toolName)) {
  process.stdout.write(JSON.stringify({ decision: 'allow' }));
  process.exit(0);
}

const filePath = input.tool_input?.path || input.tool_input?.file_path || '';
const role = process.env.GEMINI_ROLE || ''; // Set this when starting Gemini

// DEV role: must not touch test files
if (role === 'DEV') {
  const isTestFile = /\/(tests?|__tests?__|spec)\//i.test(filePath) ||
                     /\.(test|spec)\.[jt]s(x?)$/i.test(filePath);
  if (isTestFile) {
    process.stdout.write(JSON.stringify({
      decision: 'deny',
      reason: `DEV role is not allowed to modify test files. Blocked: ${filePath}`
    }));
    process.exit(0);
  }
}

// QA role: must not touch non-test files (implementation files)
if (role === 'QA') {
  const isTestFile = /\/(tests?|__tests?__|spec)\//i.test(filePath) ||
                     /\.(test|spec)\.[jt]s(x?)$/i.test(filePath);
  if (!isTestFile) {
    process.stdout.write(JSON.stringify({
      decision: 'deny',
      reason: `QA role is only allowed to modify test files. Blocked: ${filePath}`
    }));
    process.exit(0);
  }
}

// ALLOWED_PATHS override (explicit whitelist)
const allowedPaths = process.env.ALLOWED_PATHS;
if (allowedPaths && filePath) {
  const prefixes = allowedPaths.split(':').filter(Boolean);
  const allowed = prefixes.some(prefix => filePath.startsWith(prefix));
  if (!allowed) {
    process.stdout.write(JSON.stringify({
      decision: 'deny',
      reason: `Path not in allowed scope. Blocked: ${filePath}\nAllowed prefixes: ${prefixes.join(', ')}`
    }));
    process.exit(0);
  }
}

process.stdout.write(JSON.stringify({ decision: 'allow' }));
process.exit(0);
