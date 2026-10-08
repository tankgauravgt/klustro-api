import { afterEach } from 'vitest';
import { beforeEach } from 'vitest';
import { describe } from 'vitest';
import { expect } from 'vitest';
import { it } from 'vitest';
import { vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';

// import providers
import { GoogleAccessProvider } from '../../../../src/access/providers/google/google-access.provider.js';

const PROFILE = {
  provider: 'google' as const,
  providerAccountId: 'sub-1',
  email: 'jane@example.com',
  firstName: 'Jane',
  lastName: 'Doe',
};

describe('GoogleAccessProvider', () => {
  const verify = vi.fn();
  const settings: Record<string, string> = {
    APPS_AUTH__GOOGLE_CLIENT_ID: 'client-id',
    APPS_AUTH__GOOGLE_CLIENT_SECRET: 'client-secret',
  };
  const provider = new GoogleAccessProvider(
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

  it('builds an authorization-code URL with PKCE and the state', () => {
    const url = new URL(
      provider.authorizationUrl({
        redirectUri: 'http://api.test/auth/google/callback',
        state: 'st',
        codeChallenge: 'ch',
      }),
    );

    expect(url.origin + url.pathname).toBe(
      'https://accounts.google.com/o/oauth2/v2/auth',
    );
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: 'client-id',
      redirect_uri: 'http://api.test/auth/google/callback',
      response_type: 'code',
      scope: 'openid email profile',
      state: 'st',
      code_challenge: 'ch',
      code_challenge_method: 'S256',
    });
    expect(url.search).not.toContain('client-secret');
  });

  it('trades the code with the client secret and verifies the ID token it gets', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ id_token: 'the-id-token' }),
    });
    verify.mockResolvedValue(PROFILE);

    const profile = await provider.fetchProfile({
      code: 'the-code',
      redirectUri: 'http://api.test/auth/google/callback',
      codeVerifier: 'the-verifier',
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://oauth2.googleapis.com/token');
    expect(Object.fromEntries(init.body)).toEqual({
      client_id: 'client-id',
      client_secret: 'client-secret',
      code: 'the-code',
      code_verifier: 'the-verifier',
      redirect_uri: 'http://api.test/auth/google/callback',
      grant_type: 'authorization_code',
    });
    expect(verify).toHaveBeenCalledWith('the-id-token');
    expect(profile).toEqual(PROFILE);
  });

  it.each([
    [
      'Google refuses the code',
      { ok: false, json: async () => ({ error: 'invalid_grant' }) },
    ],
    ['the answer has no ID token', { ok: true, json: async () => ({}) }],
    [
      'the answer is not JSON',
      { ok: false, json: async () => Promise.reject(new Error('x')) },
    ],
  ])('is unauthorized when %s', async (_name, response) => {
    fetchMock.mockResolvedValue(response);

    await expect(
      provider.fetchProfile({ code: 'c', redirectUri: 'r', codeVerifier: 'v' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(verify).not.toHaveBeenCalled();
  });
});
