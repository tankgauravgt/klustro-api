import { describe } from 'vitest';
import { expect } from 'vitest';
import { it } from 'vitest';
import { vi } from 'vitest';

import { applyTrustProxy } from './trust-proxy.js';
import { parseTrustProxy } from './trust-proxy.js';

describe('parseTrustProxy', () => {
  it.each([undefined, '', '  ', '0', 'false', 'FALSE'])(
    'does not trust a proxy for %j',
    (value) => {
      expect(parseTrustProxy(value)).toBe(false);
    },
  );

  it('reads a number as that many proxies', () => {
    expect(parseTrustProxy('1')).toBe(1);
    expect(parseTrustProxy(' 2 ')).toBe(2);
  });

  it('reads true as trusting any forwarded address', () => {
    expect(parseTrustProxy('true')).toBe(true);
    expect(parseTrustProxy('TRUE')).toBe(true);
  });

  it('keeps a list of proxy addresses as written for Express to read', () => {
    expect(parseTrustProxy('loopback, 10.0.0.0/8')).toBe(
      'loopback, 10.0.0.0/8',
    );
  });
});

describe('applyTrustProxy', () => {
  const appWith = () => {
    const set = vi.fn();
    return {
      set,
      app: { getHttpAdapter: () => ({ getInstance: () => ({ set }) }) },
    };
  };
  const configWith = (value: string | undefined) => ({
    optional: () => value,
  });

  it('tells Express how many proxies to believe', () => {
    const { app, set } = appWith();

    applyTrustProxy(app as never, configWith('1') as never);

    expect(set).toHaveBeenCalledWith('trust proxy', 1);
  });

  it('leaves Express alone when no proxy is configured', () => {
    const { app, set } = appWith();

    applyTrustProxy(app as never, configWith(undefined) as never);
    applyTrustProxy(app as never, configWith('0') as never);

    expect(set).not.toHaveBeenCalled();
  });
});
