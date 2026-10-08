import { afterAll } from 'vitest';
import { beforeAll } from 'vitest';
import { beforeEach } from 'vitest';
import { describe } from 'vitest';
import { expect } from 'vitest';
import { it } from 'vitest';
import { vi } from 'vitest';
import { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import request from 'supertest';
import type { Server } from 'node:http';

// import application libraries
import { AppConfigService } from '@libs/common';

// import applications
import { AuthModule } from '@apps/auth';

// import features
import { PasswordService } from '../../src/trust/services/password.service.js';
import { TokenService } from '../../src/access/services/token.service.js';
import { OAuthAccount } from '../../src/identity/models/oauth-account.entity.js';
import { User } from '../../src/identity/models/user.entity.js';

// import others
import { oauthSignIn } from './support/oauth.js';
import { withFakeProviders } from './support/oauth.js';
import type { FakeProviders } from './support/oauth.js';
import { createVerifiedAccount } from './support/verified-account.js';

/**
 * Input limits, the sign-in timing guard, the reject-list clean-up and the rule that a
 * deactivated account gets no session from an OAuth sign-in either.
 */
describe('Auth hardening (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let fakes: FakeProviders;
  let frontendUrl: string;
  let aliceToken: string;

  const signUpBody = (n: number, overrides: object = {}) => ({
    username: `hardening-${n}`,
    firstName: 'Hard',
    lastName: 'Ening',
    email: `hardening-${n}@example.com`,
    password: 'secret123',
    ...overrides,
  });

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
    frontendUrl = moduleRef
      .get(AppConfigService)
      .get('WEB_URL')
      .replace(/\/+$/, '');

    aliceToken = await createVerifiedAccount(app, server, {
      username: 'hardening-alice',
      email: 'hardening-alice@example.com',
      password: 'secret123',
    });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('input limits', () => {
    it('refuses a sign-in identifier longer than any username or email', async () => {
      const res = await request(server)
        .post('/auth/signin')
        .send({ identifier: 'x'.repeat(255), password: 'secret123' });

      expect(res.status).toBe(400);
    });

    it('refuses an absurdly long sign-in password', async () => {
      const res = await request(server)
        .post('/auth/signin')
        .send({ identifier: 'hardening-alice', password: 'x'.repeat(257) });

      expect(res.status).toBe(400);
    });

    it('accepts an identifier right at the 254-character limit', async () => {
      const res = await request(server)
        .post('/auth/signin')
        .send({ identifier: 'x'.repeat(254), password: 'secret123' });

      expect(res.status).toBe(401);
    });

    it('accepts a sign-up password of exactly 72 bytes', async () => {
      const res = await request(server)
        .post('/auth/signup')
        .send(signUpBody(1, { password: 'a'.repeat(72) }));

      expect(res.status).toBe(201);
    });

    it('refuses a sign-up password bcrypt would silently cut off', async () => {
      const res = await request(server)
        .post('/auth/signup')
        .send(signUpBody(2, { password: 'a'.repeat(73) }));

      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body.message)).toContain('72 bytes');
    });

    it('counts bytes, not characters, so a multi-byte password cannot sneak past', async () => {
      // 37 characters, 74 bytes
      const res = await request(server)
        .post('/auth/signup')
        .send(signUpBody(3, { password: 'é'.repeat(37) }));

      expect(res.status).toBe(400);
    });

    it('refuses first and last names beyond 100 characters', async () => {
      const first = await request(server)
        .post('/auth/signup')
        .send(signUpBody(4, { firstName: 'x'.repeat(101) }));
      const last = await request(server)
        .post('/auth/signup')
        .send(signUpBody(5, { lastName: 'x'.repeat(101) }));

      expect(first.status).toBe(400);
      expect(last.status).toBe(400);
    });

    it('refuses to set a password longer than 72 bytes', async () => {
      const res = await request(server)
        .patch('/auth/password/set')
        .set('Authorization', `Bearer ${aliceToken}`)
        .send({ password: 'b'.repeat(73), currentPassword: 'secret123' });

      expect(res.status).toBe(400);
    });

    it('refuses an oversized current password when changing it', async () => {
      const res = await request(server)
        .patch('/auth/password/set')
        .set('Authorization', `Bearer ${aliceToken}`)
        .send({ password: 'newsecret123', currentPassword: 'c'.repeat(257) });

      expect(res.status).toBe(400);
    });
  });

  describe('sign-in timing', () => {
    it('spends a password check on an unknown name just as it does for a wrong password', async () => {
      const decoy = vi.spyOn(PasswordService.prototype, 'verifyDecoy');
      const verify = vi.spyOn(PasswordService.prototype, 'verify');
      try {
        const unknown = await request(server)
          .post('/auth/signin')
          .send({ identifier: 'nobody-here', password: 'secret123' });
        expect(unknown.status).toBe(401);
        expect(decoy).toHaveBeenCalledTimes(1);
        expect(verify).not.toHaveBeenCalled();

        decoy.mockClear();
        const wrong = await request(server).post('/auth/signin').send({
          identifier: 'hardening-alice',
          password: 'not-her-password',
        });
        expect(wrong.status).toBe(401);
        expect(verify).toHaveBeenCalledTimes(1);
        expect(decoy).not.toHaveBeenCalled();

        // Nothing in the answer tells the two apart
        expect(unknown.body).toEqual(wrong.body);
      } finally {
        decoy.mockRestore();
        verify.mockRestore();
      }
    });

    it('also spends the check on an account that has no password to check', async () => {
      const decoy = vi.spyOn(PasswordService.prototype, 'verifyDecoy');
      try {
        fakes.profile = {
          provider: 'github',
          providerAccountId: 'timing-github-user',
          email: 'timing-oauth@example.com',
          firstName: 'Time',
          lastName: 'Ing',
        };
        await oauthSignIn(server, 'github');

        const res = await request(server)
          .post('/auth/signin')
          .send({ identifier: 'timing-oauth', password: 'secret123' });

        expect(res.status).toBe(401);
        expect(decoy).toHaveBeenCalledTimes(1);
      } finally {
        decoy.mockRestore();
      }
    });
  });

  describe('reject list', () => {
    it('removes the entries of tokens that have expired and keeps the live ones', async () => {
      const tokens = app.get(TokenService);
      await tokens.revoke('expired-jti', new Date(Date.now() - 60_000));
      await tokens.revoke('live-jti', new Date(Date.now() + 60 * 60_000));

      await tokens.pruneExpired();

      expect(await tokens.isRevoked('expired-jti')).toBe(false);
      expect(await tokens.isRevoked('live-jti')).toBe(true);
    });

    it('still refuses a logged-out token after a prune', async () => {
      const token = await createVerifiedAccount(app, server, {
        username: 'hardening-bob',
        email: 'hardening-bob@example.com',
        password: 'secret123',
      });
      await request(server)
        .post('/auth/logout')
        .set('Authorization', `Bearer ${token}`)
        .expect(204);

      await app.get(TokenService).pruneExpired();

      const res = await request(server)
        .get('/auth/me')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(401);
    });
  });

  describe('every way of getting a session refuses a deactivated account', () => {
    const deactivate = (email: string) =>
      app
        .get(DataSource)
        .getRepository(User)
        .update({ email }, { isActive: false });

    const sessionCookie = (res: { headers: Record<string, unknown> }) =>
      ((res.headers['set-cookie'] as string[] | undefined) ?? []).some((c) =>
        c.startsWith('access_token='),
      );

    beforeEach(() => {
      fakes.profile = null;
    });

    it('OAuth sign-in through the verified email of the account does not link or sign in', async () => {
      await createVerifiedAccount(app, server, {
        username: 'dormant-oauth',
        email: 'dormant-oauth@example.com',
        password: 'secret123',
      });
      await deactivate('dormant-oauth@example.com');
      fakes.profile = {
        provider: 'github',
        providerAccountId: 'dormant-oauth-github',
        email: 'dormant-oauth@example.com',
        firstName: 'Dor',
        lastName: 'Mant',
      };

      const res = await oauthSignIn(server, 'github');

      expect(res.headers.location).toBe(
        `${frontendUrl}/?authError=sign_in_failed`,
      );
      expect(sessionCookie(res)).toBe(false);
      const links = await app
        .get(DataSource)
        .getRepository(OAuthAccount)
        .countBy({ providerAccountId: 'dormant-oauth-github' });
      expect(links).toBe(0);
    });

    it('signing up with its email and its password does not sign in', async () => {
      await createVerifiedAccount(app, server, {
        username: 'dormant-signup',
        email: 'dormant-signup@example.com',
        password: 'secret123',
      });
      await deactivate('dormant-signup@example.com');

      const res = await request(server)
        .post('/auth/signup')
        .send({
          ...signUpBody(20),
          email: 'dormant-signup@example.com',
          existingAccountPassword: 'secret123',
        });

      expect(res.status).toBe(403);
      expect(sessionCookie(res)).toBe(false);
    });

    it('signing up with its email and a wrong password is still a plain 401', async () => {
      await createVerifiedAccount(app, server, {
        username: 'dormant-wrong',
        email: 'dormant-wrong@example.com',
        password: 'secret123',
      });
      await deactivate('dormant-wrong@example.com');

      const res = await request(server)
        .post('/auth/signup')
        .send({
          ...signUpBody(21),
          email: 'dormant-wrong@example.com',
          existingAccountPassword: 'not-the-password',
        });

      expect(res.status).toBe(401);
    });

    it('a token from before the deactivation cannot change the password', async () => {
      const token = await createVerifiedAccount(app, server, {
        username: 'dormant-password',
        email: 'dormant-password@example.com',
        password: 'secret123',
      });
      const before = await app
        .get(DataSource)
        .getRepository(User)
        .findOneByOrFail({ email: 'dormant-password@example.com' });
      await deactivate('dormant-password@example.com');

      const res = await request(server)
        .patch('/auth/password/set')
        .set('Authorization', `Bearer ${token}`)
        .send({ password: 'brand-new-secret', currentPassword: 'secret123' });

      expect(res.status).toBe(401);
      expect(sessionCookie(res)).toBe(false);
      const after = await app
        .get(DataSource)
        .getRepository(User)
        .findOneByOrFail({ id: before.id });
      expect(after.passwordHash).toBe(before.passwordHash);
      expect(after.tokenVersion).toBe(before.tokenVersion);
    });

    it('an active account is not affected: signing up with its email and password signs in', async () => {
      await createVerifiedAccount(app, server, {
        username: 'awake-signup',
        email: 'awake-signup@example.com',
        password: 'secret123',
      });

      const res = await request(server)
        .post('/auth/signup')
        .send({
          ...signUpBody(22),
          email: 'awake-signup@example.com',
          existingAccountPassword: 'secret123',
        });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('signed_in');
      expect(sessionCookie(res)).toBe(true);
    });
  });

  describe('OAuth sign-in of a deactivated account', () => {
    beforeEach(() => {
      fakes.profile = null;
    });

    it('sends the browser back with an error instead of a session', async () => {
      fakes.profile = {
        provider: 'github',
        providerAccountId: 'deactivated-github-user',
        email: 'deactivated@example.com',
        firstName: 'De',
        lastName: 'Activated',
      };
      const first = await oauthSignIn(server, 'github');
      expect(first.headers.location).toBe(`${frontendUrl}/projects`);

      await app
        .get(DataSource)
        .getRepository(User)
        .update({ email: 'deactivated@example.com' }, { isActive: false });

      const again = await oauthSignIn(server, 'github');

      expect(again.status).toBe(302);
      expect(again.headers.location).toBe(
        `${frontendUrl}/?authError=sign_in_failed`,
      );
      const cookies =
        (again.headers['set-cookie'] as unknown as string[]) ?? [];
      expect(cookies.some((c) => c.startsWith('access_token='))).toBe(false);
    });
  });
});
