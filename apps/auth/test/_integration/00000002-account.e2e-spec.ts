import { afterAll } from 'vitest';
import { beforeAll } from 'vitest';
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
import { tokenOf } from './support/session.js';
import { createVerifiedAccount } from './support/verified-account.js';
import { markEmailVerified } from './support/verified-account.js';

/**
 * Covers the JWT guard shared by every route (Access), email management and the provider-agnostic
 * parts of connections (Identity). Connecting a provider is covered in oauth.e2e-spec.ts.
 */
describe('Auth common (e2e)', () => {
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

  async function signIn(): Promise<string> {
    const res = await request(server)
      .post('/auth/signin')
      .send({ identifier: 'alice', password: 'secret123' });
    return tokenOf(res);
  }

  describe('JwtAuthGuard', () => {
    it('rejects a request with no token with 401', async () => {
      const res = await request(server).get('/auth/emails');
      expect(res.status).toBe(401);
    });

    it('rejects a malformed token with 401', async () => {
      const res = await request(server)
        .get('/auth/emails')
        .set('Authorization', 'Bearer garbage.not.a.jwt');
      expect(res.status).toBe(401);
    });

    it('accepts a valid token', async () => {
      const token = await signIn();

      const res = await request(server)
        .get('/auth/emails')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
    });
  });

  describe('email management', () => {
    let token: string;
    let firstEmailId: string;
    let secondEmailId: string;

    beforeAll(async () => {
      token = await signIn();

      const list = await request(server)
        .get('/auth/emails')
        .set('Authorization', `Bearer ${token}`);
      firstEmailId = list.body[0].id;
    });

    it('lists the primary email created at signup', async () => {
      const res = await request(server)
        .get('/auth/emails')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].email).toBe('alice@example.com');
      expect(res.body[0].isPrimary).toBe(true);
    });

    it('adds a second email address', async () => {
      const res = await request(server)
        .post('/auth/emails')
        .set('Authorization', `Bearer ${token}`)
        .send({ email: 'alice.work@example.com' });

      expect(res.status).toBe(201);
      expect(res.body.isPrimary).toBe(false);
      secondEmailId = res.body.id;
    });

    it('rejects an email already in use by another account with 409', async () => {
      const res = await request(server)
        .post('/auth/emails')
        .set('Authorization', `Bearer ${token}`)
        .send({ email: 'alice.work@example.com' });

      expect(res.status).toBe(409);
    });

    it('refuses to remove the current primary email with 400', async () => {
      const res = await request(server)
        .delete(`/auth/emails/${firstEmailId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(400);
    });

    it('refuses to make an unverified email primary', async () => {
      const res = await request(server)
        .patch(`/auth/emails/${secondEmailId}/primary`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('verified');
    });

    it('switches the primary email once the new one is verified', async () => {
      await markEmailVerified(app, 'alice.work@example.com');

      const res = await request(server)
        .patch(`/auth/emails/${secondEmailId}/primary`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);

      const list = await request(server)
        .get('/auth/emails')
        .set('Authorization', `Bearer ${token}`);
      const primary = list.body.find(
        (e: { isPrimary: boolean }) => e.isPrimary,
      );
      expect(primary.id).toBe(secondEmailId);
    });

    it('removes the old email now that it is no longer primary', async () => {
      const res = await request(server)
        .delete(`/auth/emails/${firstEmailId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);

      const list = await request(server)
        .get('/auth/emails')
        .set('Authorization', `Bearer ${token}`);
      expect(list.body).toHaveLength(1);
    });
  });

  describe('connections (provider-agnostic)', () => {
    it('starts with no connections', async () => {
      const token = await signIn();

      const res = await request(server)
        .get('/auth/connections')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(0);
    });

    it('requires auth to list connections', async () => {
      const res = await request(server).get('/auth/connections');
      expect(res.status).toBe(401);
    });

    it('returns 404 when disconnecting a provider that is not connected', async () => {
      const token = await signIn();

      const res = await request(server)
        .delete('/auth/connections/github')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(404);
    });
  });
});
