#!/usr/bin/env node
/**
 * AfterAgent hook — validates Gemini output format and forces retry if wrong.
 *
 * Expected format:
 *   DONE | files: <list> | tests: <pass/fail N/M> | git: <hashes> | deleted_logic: <none> | notes: <line>
 *   NOT_DONE | reason: <why>
 *
 * If Gemini responds with prose/non-formatted text, return continue: false
 * so Gemini retries with the correct format.
 *
 * Hook input (stdin JSON):
 *   { event: "AfterAgent", prompt: string, prompt_response: string, stop_hook_active: boolean }
 *
 * Hook output (stdout JSON):
 *   { continue: boolean, systemMessage: string, hookSpecificOutput: { clearContext: boolean } }
 */

const input = JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf8'));

const response = (input.prompt_response || '').trim();

// Patterns that indicate a valid response
const DONE_PATTERN = /^DONE\s*\|/i;
const NOT_DONE_PATTERN = /^NOT_DONE\s*\|/i;

// If stop_hook_active, Gemini already retried — let it through to avoid infinite loop
if (input.stop_hook_active) {
  process.stdout.write(JSON.stringify({ continue: true }));
  process.exit(0);
}

if (DONE_PATTERN.test(response) || NOT_DONE_PATTERN.test(response)) {
  // Format is correct — allow through
  process.stdout.write(JSON.stringify({ continue: true }));
  process.exit(0);
}

// Format is wrong — reject and instruct Gemini to retry
process.stdout.write(JSON.stringify({
  continue: false,
  systemMessage: [
    '⚠ Output format check failed.',
    'Your response must start with either:',
    '  DONE | files: <list> | tests: <N/M pass> | git: <hashes> | deleted_logic: <none|desc> | notes: <line>',
    '  NOT_DONE | reason: <why>',
    'Retry your last response using that exact format.'
  ].join('\n'),
  hookSpecificOutput: {
    clearContext: false
  }
}));
process.exit(0);
