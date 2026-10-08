import { afterEach } from 'vitest';
import { beforeEach } from 'vitest';
import { describe } from 'vitest';
import { expect } from 'vitest';
import { it } from 'vitest';
import { vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';

// import providers
import { GithubAccessProvider } from '../../../../src/access/providers/github/github-access.provider.js';

const PROFILE = {
  provider: 'github' as const,
  providerAccountId: '42',
  email: 'jane@example.com',
  firstName: 'Jane',
  lastName: null,
};

describe('GithubAccessProvider', () => {
  const verify = vi.fn();
  const settings: Record<string, string> = {
    APPS_AUTH__GITHUB_CLIENT_ID: 'client-id',
    APPS_AUTH__GITHUB_CLIENT_SECRET: 'client-secret',
  };
  const provider = new GithubAccessProvider(
    { get: (key: string) => settings[key] } as never,
    { verify } as never,
  );
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    verify.mockReset();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('builds an authorization-code URL with PKCE, the state and the email scope', () => {
    const url = new URL(
      provider.authorizationUrl({
        redirectUri: 'http://api.test/auth/github/callback',
        state: 'st',
        codeChallenge: 'ch',
      }),
    );

    expect(url.origin + url.pathname).toBe(
      'https://github.com/login/oauth/authorize',
    );
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: 'client-id',
      redirect_uri: 'http://api.test/auth/github/callback',
      scope: 'read:user user:email',
      state: 'st',
      code_challenge: 'ch',
      code_challenge_method: 'S256',
    });
    expect(url.search).not.toContain('client-secret');
  });

  it('trades the code with the client secret, then asks GitHub who the token belongs to', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'gho_abc' }),
    });
    verify.mockResolvedValue(PROFILE);

    const profile = await provider.fetchProfile({
      code: 'the-code',
      redirectUri: 'http://api.test/auth/github/callback',
      codeVerifier: 'the-verifier',
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://github.com/login/oauth/access_token');
    expect(init.headers.Accept).toBe('application/json');
    expect(Object.fromEntries(init.body)).toEqual({
      client_id: 'client-id',
      client_secret: 'client-secret',
      code: 'the-code',
      code_verifier: 'the-verifier',
      redirect_uri: 'http://api.test/auth/github/callback',
    });
    expect(verify).toHaveBeenCalledWith('gho_abc');
    expect(profile).toEqual(PROFILE);
  });

  it.each([
    [
      'GitHub answers 200 with an error',
      { ok: true, json: async () => ({ error: 'bad_verification_code' }) },
    ],
    [
      'GitHub answers with a failure status',
      { ok: false, json: async () => ({}) },
    ],
    [
      'the answer is not JSON',
      { ok: true, json: async () => Promise.reject(new Error('x')) },
    ],
  ])('is unauthorized when %s', async (_name, response) => {
    fetchMock.mockResolvedValue(response);

    await expect(
      provider.fetchProfile({ code: 'c', redirectUri: 'r', codeVerifier: 'v' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(verify).not.toHaveBeenCalled();
  });

  it('gives up on GitHub when the token exchange does not answer in time', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'gho_abc' }),
    });
    verify.mockResolvedValue(PROFILE);

    await provider.fetchProfile({
      code: 'the-code',
      redirectUri: 'http://api.test/auth/github/callback',
      codeVerifier: 'the-verifier',
    });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.signal.aborted).toBe(false);
  });
});
