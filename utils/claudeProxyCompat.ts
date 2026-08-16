import { mergeSystemMessages } from './systemMessageMerge';

type ChatRequestBody = Record<string, any> & {
  model?: unknown;
  messages?: Array<{ role: string; content: unknown }>;
  tools?: unknown[];
};

const isClaudeModel = (model: unknown): boolean =>
  typeof model === 'string' && /claude|anthropic/i.test(model);

const hasThinkingDialect = (body: ChatRequestBody): boolean =>
  !!(body.thinking || body.reasoning_effort || body.extra_body?.thinking);

export const shouldRetryClaudeProxyCompatibility = (
  error: unknown,
  body: ChatRequestBody,
): boolean => {
  const message = error instanceof Error ? error.message : String(error || '');
  return /API Error 502\b/i.test(message)
    && isClaudeModel(body.model)
    && Array.isArray(body.tools)
    && body.tools.length > 0
    && hasThinkingDialect(body);
};

export const buildClaudeProxyCompatibilityBody = (body: ChatRequestBody): ChatRequestBody => {
  const next: ChatRequestBody = {
    ...body,
    messages: Array.isArray(body.messages) ? mergeSystemMessages(body.messages) : body.messages,
  };
  delete next.thinking;
  delete next.reasoning_effort;
  if (next.extra_body && typeof next.extra_body === 'object') {
    const extraBody = { ...next.extra_body };
    delete extraBody.thinking;
    if (Object.keys(extraBody).length) next.extra_body = extraBody;
    else delete next.extra_body;
  }
  return next;
};
