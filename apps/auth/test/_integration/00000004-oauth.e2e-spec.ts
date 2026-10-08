import { afterAll } from 'vitest';
import { beforeAll } from 'vitest';
import { beforeEach } from 'vitest';
import { describe } from 'vitest';
import { expect } from 'vitest';
import { it } from 'vitest';
import { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { createHash } from 'node:crypto';
import type { Server } from 'node:http';

// import application libraries
import { AppConfigService } from '@libs/common';

// import applications
import { AuthModule } from '@apps/auth';

// import others
import { cookieFrom } from './support/oauth.js';
import { finishLogin } from './support/oauth.js';
import { oauthSignIn } from './support/oauth.js';
import { startLogin } from './support/oauth.js';
import { withFakeProviders } from './support/oauth.js';
import type { FakeProviders } from './support/oauth.js';
import { tokenOf } from './support/session.js';
import { createVerifiedAccount } from './support/verified-account.js';

/**
 * The shared OAuth endpoints for every provider. The providers' token exchange is faked (see
 * support/oauth.ts); the state cookie, PKCE, callback, sign-in and session cookie are real.
 */
describe('OAuth providers (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let fakes: FakeProviders;
  let publicUrl: string;
  let frontendUrl: string;

  beforeAll(async () => {
    const faked = withFakeProviders(
      Test.createTestingModule({ imports: [AuthModule] }),
    );
    fakes = faked.fakes;
    const moduleRef = await faked.builder.compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.listen(0);
    server = app.getHttpServer();
    const config = moduleRef.get(AppConfigService);
    publicUrl = config.get('APPS_GW__URL').replace(/\/+$/, '');
    frontendUrl = config.get('WEB_URL').replace(/\/+$/, '');
  });

  afterAll(async () => {
    await app.close();
  });

  let counter = 0;
  const profile = (provider: 'google' | 'github', email?: string) => {
    counter += 1;
    fakes.profile = {
      provider,
      providerAccountId: `${provider}-user-${counter}`,
      email: email ?? `oauth-${counter}@example.com`,
      firstName: 'Oauth',
      lastName: 'Person',
    };
  };

  beforeEach(() => {
    fakes.profile = null;
    fakes.exchanges.length = 0;
  });

  describe('GET /auth/providers', () => {
    it('lists every way of signing in', async () => {
      const res = await request(server).get('/auth/providers');

      expect(res.body).toEqual([
        { name: 'local', kind: 'credentials' },
        { name: 'google', kind: 'oauth', loginUrl: '/auth/google/login' },
        { name: 'github', kind: 'oauth', loginUrl: '/auth/github/login' },
      ]);
    });
  });

  describe.each(['google', 'github'] as const)('%s', (provider) => {
    it('sends the browser to the provider with state, PKCE and our callback', async () => {
      const res = await startLogin(server, provider);

      expect(res.status).toBe(302);
      const url = new URL(res.headers.location);
      expect(url.origin).toBe(`https://${provider}.test`);
      expect(url.searchParams.get('redirect_uri')).toBe(
        `${publicUrl}/auth/${provider}/callback`,
      );
      expect(url.searchParams.get('state')).toBeTruthy();
      expect(url.searchParams.get('code_challenge')).toBeTruthy();
    });

    it('keeps the attempt in an httpOnly, Secure, Lax cookie limited to /auth', async () => {
      const res = await startLogin(server, provider);

      const cookie = (res.headers['set-cookie'] as unknown as string[]).find(
        (c) => c.startsWith('oauth_state='),
      )!;
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/Secure/i);
      expect(cookie).toMatch(/SameSite=Lax/i);
      expect(cookie).toMatch(/Path=\/auth/);
    });

    it('signs in, sets the session cookie and sends the browser to the web app', async () => {
      profile(provider);
      const start = await startLogin(server, provider);

      const res = await finishLogin(server, provider, start);

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe(`${frontendUrl}/projects`);
      const me = await request(server)
        .get('/auth/me')
        .set('Cookie', `access_token=${tokenOf(res)}`);
      expect(me.body.email).toBe(fakes.profile!.email);
      const session = (res.headers['set-cookie'] as unknown as string[]).find(
        (c) => c.startsWith('access_token='),
      )!;
      expect(session).toMatch(/HttpOnly/i);
      expect(session).toMatch(/SameSite=Strict/i);
    });

    it('trades the code with the PKCE verifier that matches the challenge', async () => {
      profile(provider);
      const start = await startLogin(server, provider);

      await finishLogin(server, provider, start, { code: 'the-code' });

      const [exchange] = fakes.exchanges;
      expect(exchange.code).toBe('the-code');
      expect(exchange.redirectUri).toBe(
        `${publicUrl}/auth/${provider}/callback`,
      );
      const challenge = new URL(start.headers.location).searchParams.get(
        'code_challenge',
      );
      expect(
        createHash('sha256').update(exchange.codeVerifier).digest('base64url'),
      ).toBe(challenge);
    });

    it('returns the person to the page they asked for', async () => {
      profile(provider);
      const start = await startLogin(server, provider, {
        returnUrl: '/invite/abc?x=1',
      });

      const res = await finishLogin(server, provider, start);

      expect(res.headers.location).toBe(`${frontendUrl}/invite/abc?x=1`);
    });

    it.each([
      'https://evil.example/x',
      '//evil.example',
      '/\\evil.example',
      'evil',
    ])(
      'ignores a return address that leaves the web app: %s',
      async (returnUrl) => {
        profile(provider);
        const start = await startLogin(server, provider, { returnUrl });

        const res = await finishLogin(server, provider, start);

        expect(res.headers.location).toBe(`${frontendUrl}/projects`);
      },
    );

    it('refuses a callback whose state does not match the browser’s attempt', async () => {
      profile(provider);
      const start = await startLogin(server, provider);

      const res = await finishLogin(server, provider, start, {
        state: 'forged',
      });

      expect(res.headers.location).toBe(
        `${frontendUrl}/?authError=sign_in_failed`,
      );
      expect(cookieFrom(res, 'access_token')).toBeUndefined();
      expect(fakes.exchanges).toHaveLength(0);
    });

    it('refuses a callback from a browser that never started an attempt', async () => {
      profile(provider);
      const start = await startLogin(server, provider);
      const state = new URL(start.headers.location).searchParams.get('state')!;

      const res = await request(server)
        .get(`/auth/${provider}/callback`)
        .query({ code: 'c', state })
        .redirects(0);

      expect(res.headers.location).toBe(
        `${frontendUrl}/?authError=sign_in_failed`,
      );
      expect(cookieFrom(res, 'access_token')).toBeUndefined();
    });

    it('cannot be completed twice: the attempt cookie is cleared', async () => {
      profile(provider);
      const start = await startLogin(server, provider);

      const first = await finishLogin(server, provider, start);

      expect(cookieFrom(first, 'oauth_state')).toBe('');
    });

    it('explains a declined sign-in', async () => {
      const res = await request(server)
        .get(`/auth/${provider}/callback`)
        .query({ error: 'access_denied' })
        .redirects(0);

      expect(res.headers.location).toBe(
        `${frontendUrl}/?authError=access_denied`,
      );
    });

    it('reports a failure of the provider without leaking details', async () => {
      const start = await startLogin(server, provider);

      const res = await finishLogin(server, provider, start);

      expect(res.headers.location).toBe(`${frontendUrl}/?authError=failed`);
      expect(res.headers.location).not.toMatch(/fake profile/);
    });
  });

  describe('attempts cannot be swapped between providers or with sessions', () => {
    it('refuses an attempt started for another provider', async () => {
      profile('google');
      const start = await startLogin(server, 'google');

      const res = await finishLogin(server, 'github', start);

      expect(res.headers.location).toBe(
        `${frontendUrl}/?authError=sign_in_failed`,
      );
    });

    it('does not take a session token as an attempt, nor an attempt as a session', async () => {
      profile('github');
      const signedIn = await finishLogin(
        server,
        'github',
        await startLogin(server, 'github'),
      );
      const session = tokenOf(signedIn);
      const start = await startLogin(server, 'github');
      const attempt = cookieFrom(start, 'oauth_state')!;
      const state = new URL(start.headers.location).searchParams.get('state')!;

      const asAttempt = await request(server)
        .get('/auth/github/callback')
        .query({ code: 'c', state })
        .set('Cookie', `oauth_state=${session}`)
        .redirects(0);
      const asSession = await request(server)
        .get('/auth/me')
        .set('Authorization', `Bearer ${attempt}`);

      expect(asAttempt.headers.location).toBe(
        `${frontendUrl}/?authError=sign_in_failed`,
      );
      expect(asSession.status).toBe(401);
    });
  });

  describe('existing accounts', () => {
    it('signs in to the account that holds the verified email, without a second account', async () => {
      const token = await createVerifiedAccount(app, server, {
        username: 'oauth-owner',
        email: 'owner@example.com',
        password: 'secret123',
      });
      profile('github', 'Owner@Example.com');

      const res = await finishLogin(
        server,
        'github',
        await startLogin(server, 'github'),
      );

      const [mine, viaGithub] = await Promise.all(
        [token, tokenOf(res)].map(
          async (t) =>
            (
              await request(server)
                .get('/auth/me')
                .set('Authorization', `Bearer ${t}`)
            ).body.id,
        ),
      );
      expect(viaGithub).toBe(mine);
    });
  });

  describe('GET /auth/:provider/connect', () => {
    it('requires a signed-in account', async () => {
      const res = await request(server)
        .get('/auth/github/connect')
        .redirects(0);

      expect(res.status).toBe(401);
    });

    it('links the provider to the signed-in account, whatever the provider email is', async () => {
      const token = await createVerifiedAccount(app, server, {
        username: 'connector',
        email: 'connector@example.com',
        password: 'secret123',
      });
      profile('github', 'different-address@example.com');

      const start = await request(server)
        .get('/auth/github/connect')
        .set('Authorization', `Bearer ${token}`)
        .redirects(0);
      const res = await finishLogin(server, 'github', start);

      expect(res.headers.location).toBe(`${frontendUrl}/projects`);
      expect(cookieFrom(res, 'access_token')).toBeUndefined();
      const list = await request(server)
        .get('/auth/connections')
        .set('Authorization', `Bearer ${token}`);
      expect(list.body.map((c: { provider: string }) => c.provider)).toEqual([
        'github',
      ]);
    });

    it('refuses a provider account that already belongs to someone else', async () => {
      const token = await createVerifiedAccount(app, server, {
        username: 'connector-two',
        email: 'connector2@example.com',
        password: 'secret123',
      });
      profile('google');
      await finishLogin(server, 'google', await startLogin(server, 'google'));

      const start = await request(server)
        .get('/auth/google/connect')
        .set('Authorization', `Bearer ${token}`)
        .redirects(0);
      const res = await finishLogin(server, 'google', start);

      expect(res.headers.location).toBe(`${frontendUrl}/?authError=conflict`);
    });
  });

  describe('the email of a connected provider', () => {
    const emailsOf = async (token: string) =>
      (
        await request(server)
          .get('/auth/emails')
          .set('Authorization', `Bearer ${token}`)
      ).body as { email: string; isPrimary: boolean; isVerified: boolean }[];

    const connect = async (token: string, provider: 'google' | 'github') => {
      const start = await request(server)
        .get(`/auth/${provider}/connect`)
        .set('Authorization', `Bearer ${token}`)
        .redirects(0);
      return finishLogin(server, provider, start);
    };

    it('joins the account as a verified address (sign up with GitHub, then connect Google)', async () => {
      profile('github', 'work@airline.example');
      const token = tokenOf(await oauthSignIn(server, 'github'));
      profile('google', 'personal@gmail.example');

      const res = await connect(token, 'google');

      expect(res.headers.location).toBe(`${frontendUrl}/projects`);
      const emails = await emailsOf(token);
      expect(
        emails
          .map((e) => [e.email, e.isPrimary, e.isVerified])
          .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
      ).toEqual([
        ['personal@gmail.example', false, true],
        ['work@airline.example', true, true],
      ]);
    });

    it('can then be made the primary address', async () => {
      profile('github', 'first@airline.example');
      const token = tokenOf(await oauthSignIn(server, 'github'));
      profile('google', 'second@gmail.example');
      await connect(token, 'google');
      const second = (await emailsOf(token)).find(
        (e) => e.email === 'second@gmail.example',
      )!;

      const res = await request(server)
        .patch(
          `/auth/emails/${(second as unknown as { id: string }).id}/primary`,
        )
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect((await emailsOf(token)).find((e) => e.isPrimary)?.email).toBe(
        'second@gmail.example',
      );
    });

    it('verifies an address the account had added but never verified', async () => {
      const token = await createVerifiedAccount(app, server, {
        username: 'adder',
        email: 'adder@example.com',
        password: 'secret123',
      });
      await request(server)
        .post('/auth/emails')
        .set('Authorization', `Bearer ${token}`)
        .send({ email: 'added@example.com' });
      profile('github', 'Added@Example.com');

      await connect(token, 'github');

      const emails = await emailsOf(token);
      expect(emails.filter((e) => e.email === 'added@example.com')).toEqual([
        expect.objectContaining({ isVerified: true, isPrimary: false }),
      ]);
    });

    it('does not duplicate the address the account already has as primary', async () => {
      const token = await createVerifiedAccount(app, server, {
        username: 'same-address',
        email: 'same@example.com',
        password: 'secret123',
      });
      profile('github', 'same@example.com');

      await connect(token, 'github');

      expect(await emailsOf(token)).toHaveLength(1);
    });

    it('is refused when a different account has verified that address, and nothing is linked', async () => {
      await createVerifiedAccount(app, server, {
        username: 'address-owner',
        email: 'owned@example.com',
        password: 'secret123',
      });
      const token = await createVerifiedAccount(app, server, {
        username: 'address-taker',
        email: 'taker@example.com',
        password: 'secret123',
      });
      profile('github', 'owned@example.com');

      const res = await connect(token, 'github');

      expect(res.headers.location).toBe(`${frontendUrl}/?authError=conflict`);
      expect((await emailsOf(token)).map((e) => e.email)).toEqual([
        'taker@example.com',
      ]);
      const links = await request(server)
        .get('/auth/connections')
        .set('Authorization', `Bearer ${token}`);
      expect(links.body).toHaveLength(0);
    });

    it('takes the address from an unverified claim on another account', async () => {
      const holder = await createVerifiedAccount(app, server, {
        username: 'claim-holder',
        email: 'holder@example.com',
        password: 'secret123',
      });
      await request(server)
        .post('/auth/emails')
        .set('Authorization', `Bearer ${holder}`)
        .send({ email: 'contested-connect@example.com' });
      const token = await createVerifiedAccount(app, server, {
        username: 'claim-taker',
        email: 'claimtaker@example.com',
        password: 'secret123',
      });
      profile('google', 'contested-connect@example.com');

      await connect(token, 'google');

      expect((await emailsOf(holder)).map((e) => e.email)).toEqual([
        'holder@example.com',
      ]);
      expect(
        (await emailsOf(token)).find(
          (e) => e.email === 'contested-connect@example.com',
        )?.isVerified,
      ).toBe(true);
    });
  });

  describe('removing an address a connection supplies', () => {
    type Listed = {
      id: string;
      email: string;
      isPrimary: boolean;
      providedBy: string | null;
    };
    const emailsOf = async (token: string) =>
      (
        await request(server)
          .get('/auth/emails')
          .set('Authorization', `Bearer ${token}`)
      ).body as Listed[];
    const remove = (token: string, id: string) =>
      request(server)
        .delete(`/auth/emails/${id}`)
        .set('Authorization', `Bearer ${token}`);
    const connectGoogle = async (token: string) =>
      finishLogin(
        server,
        'google',
        await request(server)
          .get('/auth/google/connect')
          .set('Authorization', `Bearer ${token}`)
          .redirects(0),
      );

    // GitHub sign-up (primary from GitHub) + Google connected (secondary from Google)
    async function githubAccountWithGoogle(tag: string) {
      profile('github', `${tag}-work@airline.example`);
      const token = tokenOf(await oauthSignIn(server, 'github'));
      profile('google', `${tag}-personal@gmail.example`);
      await connectGoogle(token);
      return token;
    }

    it('says which connection supplies each address', async () => {
      const token = await githubAccountWithGoogle('lists');

      const emails = await emailsOf(token);

      expect(
        Object.fromEntries(emails.map((e) => [e.email, e.providedBy])),
      ).toEqual({
        'lists-work@airline.example': 'github',
        'lists-personal@gmail.example': 'google',
      });
    });

    it('is refused while that connection exists, and the address stays', async () => {
      const token = await githubAccountWithGoogle('locked');
      const google = (await emailsOf(token)).find(
        (e) => e.providedBy === 'google',
      )!;

      const res = await remove(token, google.id);

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Disconnect google first');
      expect(await emailsOf(token)).toHaveLength(2);
    });

    it('works after disconnecting that connection', async () => {
      const token = await githubAccountWithGoogle('freed');
      const google = (await emailsOf(token)).find(
        (e) => e.providedBy === 'google',
      )!;
      await request(server)
        .delete('/auth/connections/google')
        .set('Authorization', `Bearer ${token}`);

      const after = (await emailsOf(token)).find((e) => e.id === google.id)!;
      const res = await remove(token, google.id);

      expect(after.providedBy).toBeNull();
      expect(res.status).toBe(200);
      expect((await emailsOf(token)).map((e) => e.email)).toEqual([
        'freed-work@airline.example',
      ]);
    });

    it('does not apply to an address the person added themselves', async () => {
      const token = await createVerifiedAccount(app, server, {
        username: 'local-emails',
        email: 'local-emails@example.com',
        password: 'secret123',
      });
      const added = await request(server)
        .post('/auth/emails')
        .set('Authorization', `Bearer ${token}`)
        .send({ email: 'extra-local@example.com' });
      profile('github', 'local-emails-gh@example.com');
      await finishLogin(
        server,
        'github',
        await request(server)
          .get('/auth/github/connect')
          .set('Authorization', `Bearer ${token}`)
          .redirects(0),
      );

      const listed = await emailsOf(token);
      const res = await remove(token, added.body.id);

      expect(
        listed.find((e) => e.email === 'extra-local@example.com')?.providedBy,
      ).toBeNull();
      expect(res.status).toBe(200);
    });

    it('keeps an address the person added as theirs when the provider later proves it', async () => {
      const token = await createVerifiedAccount(app, server, {
        username: 'own-address',
        email: 'own-address@example.com',
        password: 'secret123',
      });
      const added = await request(server)
        .post('/auth/emails')
        .set('Authorization', `Bearer ${token}`)
        .send({ email: 'own-extra@example.com' });
      profile('google', 'own-extra@example.com');
      await connectGoogle(token);

      const res = await remove(token, added.body.id);

      expect(res.status).toBe(200);
    });

    it('is still refused for the primary address, with the primary message', async () => {
      const token = await githubAccountWithGoogle('primary');
      const primary = (await emailsOf(token)).find((e) => e.isPrimary)!;

      const res = await remove(token, primary.id);

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('different primary');
    });
  });

  describe('the first password of an account made through a provider', () => {
    const setPassword = (token: string, body: object) =>
      request(server)
        .patch('/auth/password/set')
        .set('Authorization', `Bearer ${token}`)
        .send(body);

    it('needs only the new password', async () => {
      profile('github', 'first-password@airline.example');
      const token = tokenOf(await oauthSignIn(server, 'github'));

      const res = await setPassword(token, { password: 'first-pass-123' });

      expect(res.status).toBe(200);
      expect(res.body.requiresPasswordSetup).toBe(false);
      expect(
        (
          await request(server).post('/auth/signin').send({
            identifier: 'first-password@airline.example',
            password: 'first-pass-123',
          })
        ).status,
      ).toBe(201);
    });

    it('ignores a current password that was sent along, since there is none', async () => {
      profile('github', 'ignored-current@airline.example');
      const token = tokenOf(await oauthSignIn(server, 'github'));

      const res = await setPassword(token, {
        password: 'first-pass-123',
        currentPassword: 'whatever',
      });

      expect(res.status).toBe(200);
    });

    it('becomes a normal password: changing it afterwards needs the current one', async () => {
      profile('github', 'then-change@airline.example');
      const first = await setPassword(
        tokenOf(await oauthSignIn(server, 'github')),
        { password: 'first-pass-123' },
      );
      const token = tokenOf(first);

      const without = await setPassword(token, { password: 'second-pass-123' });
      const withIt = await setPassword(token, {
        password: 'second-pass-123',
        currentPassword: 'first-pass-123',
      });

      expect(without.status).toBe(400);
      expect(withIt.status).toBe(200);
    });
  });

  describe('unknown providers', () => {
    it.each(['facebook', 'local'])('answers 404 for %s', async (name) => {
      expect(
        (await request(server).get(`/auth/${name}/login`).redirects(0)).status,
      ).toBe(404);
      expect(
        (await request(server).get(`/auth/${name}/callback`).redirects(0))
          .status,
      ).toBe(404);
    });
  });
});
