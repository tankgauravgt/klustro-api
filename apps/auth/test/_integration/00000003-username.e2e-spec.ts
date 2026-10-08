import { afterAll } from 'vitest';
import { beforeAll } from 'vitest';
import { describe } from 'vitest';
import { expect } from 'vitest';
import { it } from 'vitest';
import { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { Server } from 'node:http';

// import applications
import { AuthModule } from '@apps/auth';

// import others
import { createVerifiedAccount } from './support/verified-account.js';

describe('Usernames (e2e)', () => {
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
  });

  afterAll(async () => {
    await app.close();
  });

  const account = (username: string) =>
    createVerifiedAccount(app, server, {
      username,
      email: `${username}@example.com`,
      password: 'secret123',
    });

  const rename = (token: string, username: unknown) =>
    request(server)
      .patch('/auth/username')
      .set('Authorization', `Bearer ${token}`)
      .send({ username });

  const signIn = (identifier: string) =>
    request(server)
      .post('/auth/signin')
      .send({ identifier, password: 'secret123' });

  describe('PATCH /auth/username', () => {
    it('changes the name and returns the updated profile', async () => {
      const token = await account('rename-one');

      const res = await rename(token, 'renamed.one');

      expect(res.status).toBe(200);
      expect(res.body.username).toBe('renamed.one');
    });

    it('signs in with the new name and no longer with the old one', async () => {
      const token = await account('rename-two');
      await rename(token, 'rename-two-new');

      expect((await signIn('rename-two-new')).status).toBe(201);
      expect((await signIn('rename-two')).status).toBe(401);
    });

    it('keeps the existing session working', async () => {
      const token = await account('rename-three');
      await rename(token, 'rename-three-new');

      const me = await request(server)
        .get('/auth/me')
        .set('Authorization', `Bearer ${token}`);
      expect(me.body.username).toBe('rename-three-new');
    });

    it('treats capitals as the same name and stores lowercase', async () => {
      const token = await account('case-one');

      const res = await rename(token, '  Case-ONE-New ');

      expect(res.body.username).toBe('case-one-new');
      expect((await signIn('CASE-One-New')).status).toBe(201);
    });

    it('answers 409 when another active account holds the name, in any case', async () => {
      await account('holder-one');
      const token = await account('wants-holder');

      expect((await rename(token, 'holder-one')).status).toBe(409);
      const res = await rename(token, 'Holder-ONE');
      expect(res.status).toBe(409);
      expect(res.body.message).toBe('Username already taken');
    });

    it('accepts the name you already have', async () => {
      const token = await account('same-name');

      const res = await rename(token, 'SAME-name');

      expect(res.status).toBe(200);
      expect(res.body.username).toBe('same-name');
    });

    it('frees the old name immediately for someone else', async () => {
      const first = await account('freed-name');
      await rename(first, 'freed-name-moved');
      const second = await account('freed-taker');

      expect((await rename(second, 'freed-name')).status).toBe(200);
    });

    it('lets a name be changed again and again', async () => {
      const token = await account('again-one');

      for (const name of ['again-two', 'again-three', 'again-one']) {
        expect((await rename(token, name)).status).toBe(200);
      }
    });

    it('lets only one of two simultaneous claims win', async () => {
      const a = await account('race-a');
      const b = await account('race-b');

      const results = await Promise.all([
        rename(a, 'race-prize'),
        rename(b, 'race-prize'),
      ]);

      expect(results.map((r) => r.status).sort((x, y) => x - y)).toEqual([
        200, 409,
      ]);
    });

    it.each([
      ['too short', 'ab'],
      ['too long', 'a'.repeat(33)],
      ['has a space', 'has space'],
      ['has other characters', 'bad@name'],
      ['is empty', ''],
      ['is not text', 42],
    ])('rejects a name that %s', async (_label, value) => {
      const token = await account(
        `invalid-${String(_label).length}-${Math.random().toString(36).slice(2, 7)}`,
      );

      expect((await rename(token, value)).status).toBe(400);
    });

    it('accepts the limits of the length rule', async () => {
      const token = await account('limits-one');

      expect((await rename(token, 'abc')).status).toBe(200);
      expect((await rename(token, 'a'.repeat(32))).status).toBe(200);
    });

    it('requires authentication', async () => {
      const res = await request(server)
        .patch('/auth/username')
        .send({ username: 'nobody' });

      expect(res.status).toBe(401);
    });

    it('is recorded in the audit trail with the old and new name', async () => {
      const token = await account('audited-one');
      await rename(token, 'audited-two');

      const trail = await request(server)
        .get('/auth/audit-logs')
        .set('Authorization', `Bearer ${token}`);
      const updates = trail.body.items.filter(
        (i: { action: string }) => i.action === 'user.updated',
      );
      expect(updates.map((u: { changes: unknown }) => u.changes)).toEqual(
        expect.arrayContaining([
          { fields: { username: { from: 'audited-one', to: 'audited-two' } } },
        ]),
      );
    });
  });

  describe('sign-up', () => {
    const signUp = (username: string, email: string) =>
      request(server).post('/auth/signup').send({
        username,
        email,
        firstName: 'A',
        lastName: 'B',
        password: 'secret123',
      });

    it('refuses names that break the rule', async () => {
      expect((await signUp('ab', 'u1@example.com')).status).toBe(400);
      expect((await signUp('has space', 'u2@example.com')).status).toBe(400);
      expect((await signUp('a'.repeat(33), 'u3@example.com')).status).toBe(400);
    });

    it('lowercases the name, and treats capitals as taken', async () => {
      await account('signup-taken');

      const res = await signUp('SIGNUP-Taken', 'u4@example.com');

      expect(res.status).toBe(409);
    });
  });

  describe('sign-in', () => {
    it('finds the account whatever capitals are typed', async () => {
      await account('login-case');

      expect((await signIn('LOGIN-Case')).status).toBe(201);
    });
  });
});
