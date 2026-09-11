import { afterEach, describe, expect, it } from 'vitest';
import { getServerEnv } from './env';

describe('getServerEnv', () => {
  afterEach(() => {
    delete process.env.BOLT_TEST_KEY;
  });

  it('reads variables from process.env when no context is given', () => {
    process.env.BOLT_TEST_KEY = 'from-process';
    expect(getServerEnv().BOLT_TEST_KEY).toBe('from-process');
  });

  it('reads from process.env when the context carries no cloudflare bindings', () => {
    process.env.BOLT_TEST_KEY = 'from-process';
    expect(getServerEnv({}).BOLT_TEST_KEY).toBe('from-process');
  });

  it('lets cloudflare bindings take precedence over process.env', () => {
    process.env.BOLT_TEST_KEY = 'from-process';

    const env = getServerEnv({ cloudflare: { env: { BOLT_TEST_KEY: 'from-binding' } } });

    expect(env.BOLT_TEST_KEY).toBe('from-binding');
  });

  it('keeps process.env values the bindings do not override', () => {
    process.env.BOLT_TEST_KEY = 'from-process';

    const env = getServerEnv({ cloudflare: { env: { SOMETHING_ELSE: 'x' } } });

    expect(env.BOLT_TEST_KEY).toBe('from-process');
  });

  it('coerces non-string binding values to strings', () => {
    const env = getServerEnv({ cloudflare: { env: { BOLT_TEST_KEY: 42 } } });

    expect(env.BOLT_TEST_KEY).toBe('42');
  });

  it('skips null and undefined binding values', () => {
    process.env.BOLT_TEST_KEY = 'from-process';

    const env = getServerEnv({ cloudflare: { env: { BOLT_TEST_KEY: null } } });

    expect(env.BOLT_TEST_KEY).toBe('from-process');
  });

  it('does not mutate process.env when merging bindings', () => {
    getServerEnv({ cloudflare: { env: { BOLT_TEST_KEY: 'from-binding' } } });

    expect(process.env.BOLT_TEST_KEY).toBeUndefined();
  });
});
