import { afterEach, describe, expect, it } from 'vitest';
import { getServerEnv } from './env';

describe('getServerEnv', () => {
  afterEach(() => {
    delete process.env.BOLT_TEST_KEY;
  });

  it('falls back to process.env when no context is given', () => {
    process.env.BOLT_TEST_KEY = 'from-process';
    expect(getServerEnv().BOLT_TEST_KEY).toBe('from-process');
  });

  it('falls back to process.env when the context carries nothing', () => {
    process.env.BOLT_TEST_KEY = 'from-process';
    expect(getServerEnv({}).BOLT_TEST_KEY).toBe('from-process');
  });

  it('reads the environment injected by the server entry', () => {
    const env = getServerEnv({ env: { BOLT_TEST_KEY: 'from-server-entry' } });
    expect(env.BOLT_TEST_KEY).toBe('from-server-entry');
  });

  it('lets the injected environment win over the process.env snapshot', () => {
    process.env.BOLT_TEST_KEY = 'from-process';

    const env = getServerEnv({ env: { BOLT_TEST_KEY: 'from-server-entry' } });

    expect(env.BOLT_TEST_KEY).toBe('from-server-entry');
  });

  it('lets cloudflare bindings win over the injected environment', () => {
    const env = getServerEnv({
      env: { BOLT_TEST_KEY: 'from-server-entry' },
      cloudflare: { env: { BOLT_TEST_KEY: 'from-binding' } },
    });

    expect(env.BOLT_TEST_KEY).toBe('from-binding');
  });

  it('keeps injected values that the bindings do not override', () => {
    const env = getServerEnv({
      env: { BOLT_TEST_KEY: 'from-server-entry' },
      cloudflare: { env: { SOMETHING_ELSE: 'x' } },
    });

    expect(env.BOLT_TEST_KEY).toBe('from-server-entry');
  });

  it('coerces non-string values to strings', () => {
    expect(getServerEnv({ env: { BOLT_TEST_KEY: 42 } }).BOLT_TEST_KEY).toBe('42');
  });

  it('skips null and undefined values', () => {
    process.env.BOLT_TEST_KEY = 'from-process';

    const env = getServerEnv({ env: { BOLT_TEST_KEY: null } });

    expect(env.BOLT_TEST_KEY).toBe('from-process');
  });

  it('ignores a non-object env', () => {
    process.env.BOLT_TEST_KEY = 'from-process';
    expect(getServerEnv({ env: 'nonsense' }).BOLT_TEST_KEY).toBe('from-process');
  });

  it('does not mutate process.env', () => {
    getServerEnv({ env: { BOLT_TEST_KEY: 'from-server-entry' } });
    expect(process.env.BOLT_TEST_KEY).toBeUndefined();
  });
});
