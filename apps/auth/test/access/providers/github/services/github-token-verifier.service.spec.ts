import { afterEach } from 'vitest';
import { beforeEach } from 'vitest';
import { describe } from 'vitest';
import { expect } from 'vitest';
import { it } from 'vitest';
import { vi } from 'vitest';

// import services
import { GithubTokenVerifierService } from '../../../../../src/access/providers/github/services/github-token-verifier.service.js';

describe('GithubTokenVerifierService', () => {
  const service = new GithubTokenVerifierService();
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async (url: string) => ({
      ok: true,
      json: async () =>
        url.endsWith('/emails')
          ? [{ email: 'jane@example.com', primary: true, verified: true }]
          : { id: 42, name: 'Jane Doe' },
    }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('puts a fresh deadline on each call it makes to GitHub', async () => {
    const profile = await service.verify('gho_abc');

    expect(profile.email).toBe('jane@example.com');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [first, second] = fetchMock.mock.calls.map(([, init]) => init.signal);
    expect(first).toBeInstanceOf(AbortSignal);
    expect(second).toBeInstanceOf(AbortSignal);
    // One signal per request: a shared one would already be spent for the second call
    expect(first).not.toBe(second);
  });
});
