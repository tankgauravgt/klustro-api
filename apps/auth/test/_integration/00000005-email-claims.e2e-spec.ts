import { afterAll } from 'vitest';
import { beforeAll } from 'vitest';
import { describe } from 'vitest';
import { expect } from 'vitest';
import { it } from 'vitest';
import { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import request from 'supertest';
import type { Server } from 'node:http';

// import application libraries
import { AuditLog } from '@libs/governance';

// import applications
import { AuthModule } from '@apps/auth';

// import features
import { Email } from '../../src/identity/models/email.entity.js';
import { User } from '../../src/identity/models/user.entity.js';

// import others
import { oauthSignIn } from './support/oauth.js';
import { withFakeProviders } from './support/oauth.js';
import type { FakeProviders } from './support/oauth.js';
import { tokenFromLatestMail } from './support/mailgun-stub.js';
import { tokenOf } from './support/session.js';
import { createVerifiedAccount } from './support/verified-account.js';
import { markEmailVerified } from './support/verified-account.js';

/**
 * Who may hold an email address. Sign-up and Google/GitHub sign-in share four rules:
 *   verified + password  -> prove the account by its password (sign-up) / provider proof (social)
 *   verified, no password -> explain how to sign in
 *   unverified primary   -> a pending account, which is replaced
 *   unverified secondary -> the claim is removed from its account
 */
describe('Email claims (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let dataSource: DataSource;
  let fakes: FakeProviders;

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
    dataSource = moduleRef.get(DataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  const signUp = (body: object) =>
    request(server)
      .post('/auth/signup')
      .send({
        firstName: 'New',
        lastName: 'Person',
        password: 'secret123',
        ...body,
      });

  const signIn = (identifier: string, password = 'secret123') =>
    request(server).post('/auth/signin').send({ identifier, password });

  const social = (
    email: string,
    id: string,
    provider: 'github' | 'google' = 'github',
  ) => {
    fakes.profile = {
      provider,
      providerAccountId: id,
      email,
      firstName: 'Social',
      lastName: 'Person',
    };
    return oauthSignIn(server, provider);
  };

  const me = async (token: string) =>
    (
      await request(server)
        .get('/auth/me')
        .set('Authorization', `Bearer ${token}`)
    ).body;

  const trail = async (token: string) =>
    (
      await request(server)
        .get('/auth/audit-logs')
        .set('Authorization', `Bearer ${token}`)
    ).body.items as {
      action: string;
      outcome: string;
      metadata: Record<string, unknown>;
    }[];

  describe('an account whose email is not verified', () => {
    it('is created without a session', async () => {
      const res = await signUp({
        username: 'pending-ann',
        email: 'ann@example.com',
      });

      expect(res.status).toBe(201);
      expect(res.body).toEqual({ status: 'verification_required' });
    });

    it('cannot sign in, even with the right password', async () => {
      const res = await signIn('pending-ann');

      expect(res.status).toBe(403);
      expect(res.body.message).toContain('Verify your email');
    });

    it('cannot sign in by email either', async () => {
      expect((await signIn('ann@example.com')).status).toBe(403);
    });

    it('is not verified by resetting its password', async () => {
      await request(server)
        .post('/auth/password/forgot')
        .send({ email: 'ann@example.com' });
      const token = tokenFromLatestMail('/reset-password');
      await request(server)
        .post('/auth/password/reset')
        .send({ token, newPassword: 'brand-new-pass' });

      expect((await signIn('pending-ann', 'brand-new-pass')).status).toBe(403);
    });

    it('cannot call the API with a token issued before it lost its verification', async () => {
      const token = await createVerifiedAccount(app, server, {
        username: 'was-verified',
        email: 'was-verified@example.com',
        password: 'secret123',
      });
      expect(
        (
          await request(server)
            .get('/auth/me')
            .set('Authorization', `Bearer ${token}`)
        ).status,
      ).toBe(200);

      await dataSource
        .getRepository(User)
        .update({ username: 'was-verified' }, { isEmailVerified: false });

      const res = await request(server)
        .get('/auth/me')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(401);
    });
  });

  describe('signing up with an email that a verified account holds', () => {
    let ownerToken: string;
    let ownerId: string;

    beforeAll(async () => {
      ownerToken = await createVerifiedAccount(app, server, {
        username: 'vera',
        firstName: 'Vera',
        lastName: 'Original',
        email: 'vera@example.com',
        password: 'vera-password',
      });
      ownerId = (await me(ownerToken)).id;
    });

    it('asks for that account’s password instead of creating anything', async () => {
      const users = await dataSource.getRepository(User).count();

      const res = await signUp({
        username: 'vera-new',
        email: 'vera@example.com',
      });

      expect(res.body).toEqual({ status: 'password_required' });
      expect(await dataSource.getRepository(User).count()).toBe(users);
    });

    it('refuses a wrong password and tells the owner about the attempt', async () => {
      const res = await signUp({
        username: 'vera-new',
        email: 'vera@example.com',
        existingAccountPassword: 'not-her-password',
      });

      expect(res.status).toBe(401);
      expect(res.body.accessToken).toBeUndefined();
      const attempt = (await trail(ownerToken)).find(
        (i) => i.action === 'auth.signup.existing_account',
      );
      expect(attempt).toMatchObject({
        outcome: 'failure',
        metadata: { reason: 'wrong_password' },
      });
    });

    it('signs in to the existing account on the right password, and nothing else changes', async () => {
      const users = await dataSource.getRepository(User).count();

      const res = await signUp({
        username: 'vera-new',
        firstName: 'Someone',
        lastName: 'Else',
        email: 'vera@example.com',
        existingAccountPassword: 'vera-password',
      });

      expect(res.body.status).toBe('signed_in');
      const profile = await me(tokenOf(res));
      expect(profile).toMatchObject({
        id: ownerId,
        firstName: 'Vera',
        lastName: 'Original',
        username: 'vera',
      });
      expect(await dataSource.getRepository(User).count()).toBe(users);
      expect((await signIn('vera-new')).status).toBe(401);
    });

    it('recognizes the address however it is capitalized', async () => {
      const res = await signUp({
        username: 'vera-case',
        email: '  VERA@Example.COM ',
      });

      expect(res.body).toEqual({ status: 'password_required' });
    });

    it('lets the same person sign in by email in any capitalization', async () => {
      expect((await signIn('Vera@EXAMPLE.com', 'vera-password')).status).toBe(
        201,
      );
    });
  });

  describe('signing up with an email that a verified social account holds', () => {
    it('explains how to sign in, without asking for a password that does not exist', async () => {
      await social('sofia@example.com', 'gh-sofia');

      const res = await signUp({
        username: 'sofia-local',
        email: 'sofia@example.com',
      });

      expect(res.status).toBe(409);
      expect(res.body.message).toContain('Google or GitHub');
    });
  });

  describe('signing up with an email that a verified secondary email holds', () => {
    it('asks for the owning account’s password and signs in to it', async () => {
      const token = await createVerifiedAccount(app, server, {
        username: 'sam',
        email: 'sam@example.com',
        password: 'sam-password',
      });
      await request(server)
        .post('/auth/emails')
        .set('Authorization', `Bearer ${token}`)
        .send({ email: 'sam.alt@example.com' });
      await markEmailVerified(app, 'sam.alt@example.com');

      const ask = await signUp({
        username: 'sam-new',
        email: 'sam.alt@example.com',
      });
      expect(ask.body).toEqual({ status: 'password_required' });

      const res = await signUp({
        username: 'sam-new',
        email: 'sam.alt@example.com',
        existingAccountPassword: 'sam-password',
      });
      expect((await me(tokenOf(res))).username).toBe('sam');
    });
  });

  describe('signing up with an email that an unverified primary email holds', () => {
    it('replaces the pending account', async () => {
      await signUp({ username: 'squatter', email: 'victim@example.com' });

      const res = await signUp({
        username: 'victim-real',
        email: 'victim@example.com',
      });

      expect(res.body).toEqual({ status: 'verification_required' });
      const old = await dataSource.getRepository(User).findOneOrFail({
        where: { username: 'squatter' },
        withDeleted: true,
      });
      expect(old.deletedAt).toBeInstanceOf(Date);
      expect(
        await dataSource
          .getRepository(User)
          .findOneBy({ username: 'squatter' }),
      ).toBeNull();
      expect(
        await dataSource
          .getRepository(User)
          .findOneBy({ username: 'victim-real' }),
      ).not.toBeNull();
    });

    it('keeps a record of the replacement', async () => {
      const old = await dataSource.getRepository(User).findOneOrFail({
        where: { username: 'squatter' },
        withDeleted: true,
      });

      const entry = await dataSource
        .getRepository(AuditLog)
        .findOneByOrFail({ action: 'auth.account.replaced', entityId: old.id });
      expect(JSON.parse(entry.metadata)).toMatchObject({ by: 'signup' });
    });

    it('frees the replaced account’s username', async () => {
      await signUp({ username: 'reusable-name', email: 'first@example.com' });

      const res = await signUp({
        username: 'reusable-name',
        email: 'first@example.com',
      });

      expect(res.body.status).toBe('verification_required');
    });

    it('leaves the pending account alone if the new sign-up fails (username taken)', async () => {
      await signUp({ username: 'holder', email: 'holder@example.com' });
      await createVerifiedAccount(app, server, {
        username: 'taken-name',
        email: 'taken@example.com',
        password: 'secret123',
      });

      const res = await signUp({
        username: 'taken-name',
        email: 'holder@example.com',
      });

      expect(res.status).toBe(409);
      expect(
        await dataSource.getRepository(User).findOneBy({ username: 'holder' }),
      ).not.toBeNull();
    });
  });

  describe('signing up with an email that an unverified secondary email holds', () => {
    it('removes the claim and leaves the owning account intact', async () => {
      const token = await createVerifiedAccount(app, server, {
        username: 'owner-olga',
        email: 'olga@example.com',
        password: 'secret123',
      });
      await request(server)
        .post('/auth/emails')
        .set('Authorization', `Bearer ${token}`)
        .send({ email: 'contested@example.com' });

      const res = await signUp({
        username: 'claimant',
        email: 'contested@example.com',
      });

      expect(res.body).toEqual({ status: 'verification_required' });
      const emails = await request(server)
        .get('/auth/emails')
        .set('Authorization', `Bearer ${token}`);
      expect(emails.body.map((e: { email: string }) => e.email)).toEqual([
        'olga@example.com',
      ]);
      expect((await signIn('owner-olga')).status).toBe(201);
    });

    it('tells the owning account’s owner', async () => {
      const token = tokenOf(await signIn('owner-olga'));

      const entry = (await trail(token)).find(
        (i) => i.action === 'auth.email.claim_stripped',
      );

      expect(entry).toMatchObject({
        metadata: { reason: 'unverified_email_claimed', by: 'signup' },
      });
    });
  });

  describe.each(['github', 'google'] as const)(
    'signing in with %s',
    (provider) => {
      const tag = provider;

      it('creates a verified account that can use the API straight away', async () => {
        const res = await social(
          `new-${tag}@example.com`,
          `${tag}-new`,
          provider,
        );

        expect(res.status).toBe(302);
        expect((await me(tokenOf(res))).email).toBe(`new-${tag}@example.com`);
      });

      it('signs in to the account that holds the verified email, without a second account', async () => {
        const token = await createVerifiedAccount(app, server, {
          username: `verified-${tag}`,
          email: `verified-${tag}@example.com`,
          password: 'secret123',
        });
        const ownerId = (await me(token)).id;
        const users = await dataSource.getRepository(User).count();

        const res = await social(
          `verified-${tag}@example.com`,
          `${tag}-verified`,
          provider,
        );

        expect((await me(tokenOf(res))).id).toBe(ownerId);
        expect(await dataSource.getRepository(User).count()).toBe(users);
      });

      it('signs in to the account that holds the email as a verified secondary', async () => {
        const token = await createVerifiedAccount(app, server, {
          username: `secondary-${tag}`,
          email: `primary-${tag}@example.com`,
          password: 'secret123',
        });
        const ownerId = (await me(token)).id;
        await request(server)
          .post('/auth/emails')
          .set('Authorization', `Bearer ${token}`)
          .send({ email: `second-${tag}@example.com` });
        await markEmailVerified(app, `second-${tag}@example.com`);
        const users = await dataSource.getRepository(User).count();

        const res = await social(
          `second-${tag}@example.com`,
          `${tag}-secondary`,
          provider,
        );

        expect((await me(tokenOf(res))).id).toBe(ownerId);
        expect(await dataSource.getRepository(User).count()).toBe(users);
      });

      it('replaces a pending account that only claimed the email', async () => {
        await signUp({
          username: `pending-${tag}`,
          email: `pending-${tag}@example.com`,
        });
        const pending = await dataSource
          .getRepository(User)
          .findOneByOrFail({ username: `pending-${tag}` });

        const res = await social(
          `pending-${tag}@example.com`,
          `${tag}-pending`,
          provider,
        );

        expect(res.status).toBe(302);
        expect((await me(tokenOf(res))).id).not.toBe(pending.id);
        const replaced = await dataSource
          .getRepository(User)
          .findOneOrFail({ where: { id: pending.id }, withDeleted: true });
        expect(replaced.deletedAt).toBeInstanceOf(Date);
      });

      it('does not link to a pending account, so a password set there never gets in', async () => {
        await signUp({
          username: `planted-${tag}`,
          email: `planted-${tag}@example.com`,
          password: 'attacker-password',
        });

        await social(`planted-${tag}@example.com`, `${tag}-planted`, provider);

        expect(
          (await signIn(`planted-${tag}`, 'attacker-password')).status,
        ).toBe(401);
      });

      it('removes an unverified secondary claim and keeps the account that held it', async () => {
        const token = await createVerifiedAccount(app, server, {
          username: `holder-${tag}`,
          email: `holder-${tag}@example.com`,
          password: 'secret123',
        });
        await request(server)
          .post('/auth/emails')
          .set('Authorization', `Bearer ${token}`)
          .send({ email: `stolen-${tag}@example.com` });

        const res = await social(
          `stolen-${tag}@example.com`,
          `${tag}-stolen`,
          provider,
        );

        expect((await me(tokenOf(res))).id).not.toBe((await me(token)).id);
        const emails = await request(server)
          .get('/auth/emails')
          .set('Authorization', `Bearer ${token}`);
        expect(emails.body.map((e: { email: string }) => e.email)).toEqual([
          `holder-${tag}@example.com`,
        ]);
      });

      it('matches the email however the provider capitalizes it', async () => {
        const token = await createVerifiedAccount(app, server, {
          username: `case-${tag}`,
          email: `case-${tag}@example.com`,
          password: 'secret123',
        });

        const res = await social(
          `Case-${tag}@Example.com`,
          `${tag}-case`,
          provider,
        );

        expect((await me(tokenOf(res))).id).toBe((await me(token)).id);
      });
    },
  );

  describe('bookkeeping', () => {
    it('stores every email in lowercase', async () => {
      await signUp({ username: 'mixed', email: 'MiXeD@Example.COM' });

      const stored = await dataSource
        .getRepository(Email)
        .findOneByOrFail({ email: 'mixed@example.com' });
      expect(stored.isVerified).toBe(false);
    });
  });
});
