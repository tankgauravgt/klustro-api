import { TestingModuleBuilder } from '@nestjs/testing';
import request from 'supertest';
import type { Response } from 'supertest';
import type { Server } from 'node:http';

// import features
import type { OAuthProfile } from '../../../src/access/interfaces/oauth-profile.js';

// import providers
import { GithubAccessProvider } from '../../../src/access/providers/github/github-access.provider.js';
import { GoogleAccessProvider } from '../../../src/access/providers/google/google-access.provider.js';

/*
 * Stands in for the providers' token exchange (which needs real credentials and the network):
 * whatever `current.profile` holds is "who the provider says signed in". Everything else, the
 * state cookie, the callback, sign-in and the session cookie, runs for real.
 */
export interface FakeProviders {
  profile: OAuthProfile | null;
  // What the fake provider was asked to exchange, latest last
  exchanges: { code: string; redirectUri: string; codeVerifier: string }[];
}

export function withFakeProviders(builder: TestingModuleBuilder): {
  builder: TestingModuleBuilder;
  fakes: FakeProviders;
} {
  const fakes: FakeProviders = { profile: null, exchanges: [] };

  const fake = (name: 'google' | 'github') => ({
    name,
    kind: 'oauth' as const,
    authorizationUrl: (r: {
      state: string;
      redirectUri: string;
      codeChallenge: string;
    }) =>
      `https://${name}.test/authorize?${new URLSearchParams({
        state: r.state,
        redirect_uri: r.redirectUri,
        code_challenge: r.codeChallenge,
      })}`,
    fetchProfile: async (exchange: FakeProviders['exchanges'][number]) => {
      fakes.exchanges.push(exchange);
      if (!fakes.profile) {
        throw new Error('no fake profile set for this test');
      }
      return { ...fakes.profile, provider: name };
    },
  });

  return {
    builder: builder
      .overrideProvider(GoogleAccessProvider)
      .useValue(fake('google'))
      .overrideProvider(GithubAccessProvider)
      .useValue(fake('github')),
    fakes,
  };
}

export function cookieFrom(
  response: Response,
  name: string,
): string | undefined {
  const cookies = (response.headers['set-cookie'] as unknown as string[]) ?? [];
  const found = cookies.find((cookie) => cookie.startsWith(`${name}=`));
  return found?.split(';')[0].slice(name.length + 1);
}

export const startLogin = (
  server: Server,
  provider: string,
  query: Record<string, string> = {},
) => request(server).get(`/auth/${provider}/login`).query(query).redirects(0);

export function finishLogin(
  server: Server,
  provider: string,
  start: Response,
  query: Record<string, string> = {},
) {
  const state = new URL(start.headers.location).searchParams.get('state');
  const cookie = cookieFrom(start, 'oauth_state');
  return request(server)
    .get(`/auth/${provider}/callback`)
    .query({ code: 'fake-code', ...(state && { state }), ...query })
    .set('Cookie', cookie ? `oauth_state=${cookie}` : '')
    .redirects(0);
}

// A whole successful round trip: the response is the callback's redirect
export async function oauthSignIn(
  server: Server,
  provider: 'google' | 'github',
) {
  return finishLogin(server, provider, await startLogin(server, provider));
}
