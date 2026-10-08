import { afterAll } from 'vitest';
import { beforeAll } from 'vitest';
import { beforeEach } from 'vitest';
import { describe } from 'vitest';
import { expect } from 'vitest';
import { it } from 'vitest';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { Server } from 'node:http';

// import applications
import { AuthModule } from '@apps/auth';

// import others
import { sentMail, tokenFromLatestMail } from './support/mailgun-stub.js';
import { tokenOf } from './support/session.js';
import { createVerifiedAccount } from './support/verified-account.js';

/** Covers password sign-in and sign-out (Access), sign-up and recovery (Trust), set password (Identity). */
describe('Auth local (e2e)', () => {
  let app: INestApplication;
  let server: Server;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AuthModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.listen(0);
    server = app.getHttpServer();

    await createVerifiedAccount(app, server, {
      username: 'alice',
      firstName: 'Alice',
      lastName: 'Smith',
      email: 'alice@example.com',
      password: 'secret123',
    });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /auth/signup', () => {
    it('creates an account that cannot be used until its email is verified', async () => {
      const res = await request(server).post('/auth/signup').send({
        username: 'newbie',
        firstName: 'New',
        lastName: 'Bie',
        email: 'newbie@example.com',
        password: 'secret123',
      });

      expect(res.status).toBe(201);
      expect(res.body).toEqual({ status: 'verification_required' });
      expect(res.body.accessToken).toBeUndefined();
    });

    it('rejects a duplicate username with 409', async () => {
      const res = await request(server).post('/auth/signup').send({
        username: 'alice',
        firstName: 'Alice',
        lastName: 'Other',
        email: 'alice2@example.com',
        password: 'secret123',
      });

      expect(res.status).toBe(409);
    });

    it('asks for the password when the email belongs to a verified account', async () => {
      const res = await request(server).post('/auth/signup').send({
        username: 'alice-two',
        firstName: 'Alice',
        lastName: 'Other',
        email: 'alice@example.com',
        password: 'secret123',
      });

      expect(res.status).toBe(201);
      expect(res.body).toEqual({ status: 'password_required' });
    });

    it('rejects a password shorter than 8 characters with 400', async () => {
      const res = await request(server).post('/auth/signup').send({
        username: 'shortpw',
        firstName: 'Short',
        lastName: 'Pw',
        email: 'shortpw@example.com',
        password: 'short',
      });

      expect(res.status).toBe(400);
    });

    it('rejects an invalid email with 400', async () => {
      const res = await request(server).post('/auth/signup').send({
        username: 'bademail',
        firstName: 'Bad',
        lastName: 'Email',
        email: 'not-an-email',
        password: 'secret123',
      });

      expect(res.status).toBe(400);
    });
  });

  describe('POST /auth/signin', () => {
    it('signs in with a username', async () => {
      const res = await request(server)
        .post('/auth/signin')
        .send({ identifier: 'alice', password: 'secret123' });

      expect(res.status).toBe(201);
      expect(tokenOf(res)).toBeTypeOf('string');
    });

    it('signs in with an email', async () => {
      const res = await request(server)
        .post('/auth/signin')
        .send({ identifier: 'alice@example.com', password: 'secret123' });

      expect(res.status).toBe(201);
      expect(tokenOf(res)).toBeTypeOf('string');
    });

    it('rejects the wrong password with 401', async () => {
      const res = await request(server)
        .post('/auth/signin')
        .send({ identifier: 'alice', password: 'wrong-password' });

      expect(res.status).toBe(401);
    });

    it('rejects an unknown identifier with 401', async () => {
      const res = await request(server)
        .post('/auth/signin')
        .send({ identifier: 'nobody-here', password: 'secret123' });

      expect(res.status).toBe(401);
    });
  });

  describe('POST /auth/logout', () => {
    it('revokes only the token used to log out, not the whole account', async () => {
      const signIn1 = await request(server)
        .post('/auth/signin')
        .send({ identifier: 'alice', password: 'secret123' });
      const signIn2 = await request(server)
        .post('/auth/signin')
        .send({ identifier: 'alice', password: 'secret123' });
      const token1 = tokenOf(signIn1);
      const token2 = tokenOf(signIn2);

      const logoutRes = await request(server)
        .post('/auth/logout')
        .set('Authorization', `Bearer ${token1}`);
      expect(logoutRes.status).toBe(204);

      const afterLogout = await request(server)
        .get('/auth/emails')
        .set('Authorization', `Bearer ${token1}`);
      expect(afterLogout.status).toBe(401);

      const otherTokenStillWorks = await request(server)
        .get('/auth/emails')
        .set('Authorization', `Bearer ${token2}`);
      expect(otherTokenStillWorks.status).toBe(200);
    });
  });

  describe('password forgot/reset', () => {
    beforeEach(() => {
      sentMail.length = 0;
    });

    it('mails a reset link to a registered email', async () => {
      const res = await request(server)
        .post('/auth/password/forgot')
        .send({ email: 'alice@example.com' });

      expect(res.status).toBe(201);
      expect(res.body).toEqual({ message: expect.any(String) });
      expect(sentMail).toHaveLength(1);
      expect(sentMail[0].to).toContain('alice@example.com');
      expect(sentMail[0].text).toContain('/reset-password?token=');
    });

    it('answers the same for an unregistered email, and sends nothing', async () => {
      const res = await request(server)
        .post('/auth/password/forgot')
        .send({ email: 'ghost@example.com' });

      expect(res.status).toBe(201);
      expect(res.body).toEqual({ message: expect.any(String) });
      expect(res.body.resetLink).toBeUndefined();
      expect(sentMail).toHaveLength(0);
    });

    it('resets the password, bumps tokenVersion, and invalidates old tokens', async () => {
      const oldSignIn = await request(server)
        .post('/auth/signin')
        .send({ identifier: 'alice', password: 'secret123' });
      const oldToken = tokenOf(oldSignIn);

      await request(server)
        .post('/auth/password/forgot')
        .send({ email: 'alice@example.com' });
      const resetToken = tokenFromLatestMail('/reset-password');

      const resetRes = await request(server)
        .post('/auth/password/reset')
        .send({ token: resetToken, newPassword: 'newpassword456' });
      expect(resetRes.status).toBe(201);

      const oldTokenNowRejected = await request(server)
        .get('/auth/emails')
        .set('Authorization', `Bearer ${oldToken}`);
      expect(oldTokenNowRejected.status).toBe(401);

      const signInOldPassword = await request(server)
        .post('/auth/signin')
        .send({ identifier: 'alice', password: 'secret123' });
      expect(signInOldPassword.status).toBe(401);

      const signInNewPassword = await request(server)
        .post('/auth/signin')
        .send({ identifier: 'alice', password: 'newpassword456' });
      expect(signInNewPassword.status).toBe(201);
    });

    it('rejects an invalid reset token with 400', async () => {
      const res = await request(server)
        .post('/auth/password/reset')
        .send({ token: 'not-a-real-token', newPassword: 'whatever123' });

      expect(res.status).toBe(400);
    });

    it('rejects a reused reset token with 400', async () => {
      await request(server)
        .post('/auth/password/forgot')
        .send({ email: 'alice@example.com' });
      const resetToken = tokenFromLatestMail('/reset-password');

      const first = await request(server)
        .post('/auth/password/reset')
        .send({ token: resetToken, newPassword: 'anotherpassword789' });
      expect(first.status).toBe(201);

      const second = await request(server)
        .post('/auth/password/reset')
        .send({ token: resetToken, newPassword: 'yetanotherpassword' });
      expect(second.status).toBe(400);
    });
  });

  describe('PATCH /auth/password/set', () => {
    it('sets a new password and returns a fresh token, invalidating the one used to call it', async () => {
      const signIn = await request(server)
        .post('/auth/signin')
        .send({ identifier: 'alice', password: 'anotherpassword789' });
      const oldToken = tokenOf(signIn);

      const setRes = await request(server)
        .patch('/auth/password/set')
        .set('Authorization', `Bearer ${oldToken}`)
        .send({
          password: 'finalpassword000',
          currentPassword: 'anotherpassword789',
        });
      expect(setRes.status).toBe(200);
      const newToken = tokenOf(setRes);
      expect(newToken).toBeTypeOf('string');
      expect(newToken).not.toBe(oldToken);

      const oldTokenRejected = await request(server)
        .get('/auth/emails')
        .set('Authorization', `Bearer ${oldToken}`);
      expect(oldTokenRejected.status).toBe(401);

      const newTokenWorks = await request(server)
        .get('/auth/emails')
        .set('Authorization', `Bearer ${newToken}`);
      expect(newTokenWorks.status).toBe(200);
    });

    it('rejects a password shorter than 8 characters with 400', async () => {
      const signIn = await request(server)
        .post('/auth/signin')
        .send({ identifier: 'alice', password: 'finalpassword000' });

      const res = await request(server)
        .patch('/auth/password/set')
        .set('Authorization', `Bearer ${tokenOf(signIn)}`)
        .send({ password: 'short', currentPassword: 'finalpassword000' });

      expect(res.status).toBe(400);
    });
  });

  describe('PATCH /auth/password/set on an account that already has a password', () => {
    let token: string;
    const change = (body: object, bearer = token) =>
      request(server)
        .patch('/auth/password/set')
        .set('Authorization', `Bearer ${bearer}`)
        .send(body);

    beforeAll(async () => {
      token = await createVerifiedAccount(app, server, {
        username: 'pw-changer',
        email: 'pw-changer@example.com',
        password: 'original-pass1',
      });
    });

    it('needs the current password', async () => {
      const res = await change({ password: 'brand-new-pass1' });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('current password');
    });

    it('refuses a wrong current password and changes nothing', async () => {
      const res = await change({
        password: 'brand-new-pass1',
        currentPassword: 'not-the-password',
      });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Current password is incorrect');
      // still signed in (a 401 would have signed the person out of the app)
      expect(
        (
          await request(server)
            .get('/auth/me')
            .set('Authorization', `Bearer ${token}`)
        ).status,
      ).toBe(200);
      // and the old password still works, the new one does not
      expect(
        (
          await request(server)
            .post('/auth/signin')
            .send({ identifier: 'pw-changer', password: 'original-pass1' })
        ).status,
      ).toBe(201);
      expect(
        (
          await request(server)
            .post('/auth/signin')
            .send({ identifier: 'pw-changer', password: 'brand-new-pass1' })
        ).status,
      ).toBe(401);
    });

    it('records the refused attempts in the owner’s trail', async () => {
      await change({ password: 'brand-new-pass1' });
      await change({ password: 'brand-new-pass1', currentPassword: 'nope' });

      const trail = await request(server)
        .get('/auth/audit-logs')
        .set('Authorization', `Bearer ${token}`);
      const reasons = trail.body.items
        .filter((i: { action: string }) => i.action === 'auth.password.change')
        .map((i: { outcome: string; metadata: { reason: string } }) => [
          i.outcome,
          i.metadata.reason,
        ]);
      expect(reasons).toEqual(
        expect.arrayContaining([
          ['failure', 'wrong_current_password'],
          ['failure', 'current_password_missing'],
        ]),
      );
      expect(JSON.stringify(trail.body)).not.toContain('original-pass1');
      expect(JSON.stringify(trail.body)).not.toContain('nope');
    });

    it('refuses a new password equal to the current one', async () => {
      const res = await change({
        password: 'original-pass1',
        currentPassword: 'original-pass1',
      });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('different');
    });

    it('changes it with the right current password, and the old one stops working', async () => {
      const res = await change({
        password: 'brand-new-pass1',
        currentPassword: 'original-pass1',
      });

      expect(res.status).toBe(200);
      expect(
        (
          await request(server)
            .post('/auth/signin')
            .send({ identifier: 'pw-changer', password: 'brand-new-pass1' })
        ).status,
      ).toBe(201);
      expect(
        (
          await request(server)
            .post('/auth/signin')
            .send({ identifier: 'pw-changer', password: 'original-pass1' })
        ).status,
      ).toBe(401);
    });
  });
});
