import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { classify } from './summarize.js';

// The body OpenAI sent on 2026-09-29, when the balance ran out.
const NO_CREDITS = JSON.stringify(
  {
    error: {
      message: 'You have no credits remaining.',
      type: 'insufficient_quota',
      code: 'credit_balance_exhausted',
    },
  },
  null,
  4,
);

describe('what an OpenAI failure says', () => {
  beforeEach(() => vi.stubEnv('OPENAI_API_KEY', 'test'));
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('names an empty balance on one line, without retrying', async () => {
    const fetch = vi.fn(async () => new Response(NO_CREDITS, { status: 429 }));
    vi.stubGlobal('fetch', fetch);

    const err = await classify('a headline', 'example.com').catch((e: unknown) => String(e));

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(err).toMatch(/OpenAI 429: .*insufficient_quota/);
    expect(err).not.toContain('\n');
  });

  it('keeps the last response when a rate limit outlasts the retries', async () => {
    vi.useFakeTimers();
    const body = JSON.stringify({ error: { type: 'rate_limit_exceeded' } });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(body, { status: 429 })),
    );

    const pending = classify('a headline', 'example.com').catch((e: unknown) => String(e));
    await vi.runAllTimersAsync();
    vi.useRealTimers();

    expect(await pending).toMatch(/retries exhausted \(OpenAI 429: .*rate_limit_exceeded/);
  });
});
