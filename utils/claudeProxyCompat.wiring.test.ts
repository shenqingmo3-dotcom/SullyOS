import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../hooks/useChatAI.ts', import.meta.url), 'utf8');

describe('Claude relay compatibility wiring', () => {
  it('retries the main chat request once with the compatibility body', () => {
    expect(source).toContain('shouldRetryClaudeProxyCompatibility(requestError, attemptedBody)');
    expect(source).toContain('JSON.stringify(buildClaudeProxyCompatibilityBody(attemptedBody))');
    expect(source).toContain("purpose: 'Claude 中转兼容重试'");
  });
});
