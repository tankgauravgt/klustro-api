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
import { AuditService } from '@libs/governance';
import type { AuditLogEntry } from '@libs/governance';

// import applications
import { AuthModule } from '@apps/auth';

// import features
import { Email } from '../../src/identity/models/email.entity.js';
import { TokenService } from '../../src/access/services/token.service.js';

// import models
import { RevokedToken } from '../../src/access/models/revoked-token.entity.js';

// import others
import { tokenOf } from './support/session.js';
import { createVerifiedAccount } from './support/verified-account.js';
import { markEmailVerified } from './support/verified-account.js';

/**
 * Covers the governance model of the auth service: security events are
 * audited (including refusals), nothing is hard-deleted, secrets never reach
 * the log, and users can read only their own trail.
 */
describe('Auth governance (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let dataSource: DataSource;
  let audit: AuditService;
  let tokens: TokenService;

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
    dataSource = moduleRef.get(DataSource);
    audit = moduleRef.get(AuditService);
    tokens = moduleRef.get(TokenService);
  });

  afterAll(async () => {
    await app.close();
  });

  function signUp(username: string): Promise<string> {
    return createVerifiedAccount(app, server, {
      username,
      email: `${username}@example.com`,
      password: 'secret123',
    });
  }

  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function trail(token: string, query = ''): Promise<AuditLogEntry[]> {
    const res = await request(server)
      .get(`/auth/audit-logs${query}`)
      .set(bearer(token));
    return res.body.items;
  }

  async function userIdOf(token: string): Promise<string> {
    const res = await request(server).get('/auth/me').set(bearer(token));
    return res.body.id;
  }

  describe('GET /auth/audit-logs', () => {
    it('requires authentication', async () => {
      const res = await request(server).get('/auth/audit-logs');
      expect(res.status).toBe(401);
    });

    it('shows account creation, including the anonymous sign-up actor', async () => {
      const token = await signUp('gov-alice');
      const userId = await userIdOf(token);

      const items = await trail(token);
      const created = items.find((i) => i.action === 'user.created')!;

      expect(created).toMatchObject({
        entityType: 'user',
        entityId: userId,
        actorType: 'anonymous',
        service: 'auth',
      });
      expect(items.map((i) => i.action)).toContain('email.created');
    });

    it('shows only the caller’s own events', async () => {
      const alice = await signUp('iso-alice');
      const bob = await signUp('iso-bob');
      const aliceId = await userIdOf(alice);

      const bobEvents = await trail(bob);
      expect(bobEvents.length).toBeGreaterThan(0);
      expect(bobEvents.some((event) => event.entityId === aliceId)).toBe(false);
    });
  });

  describe('sign-in events', () => {
    it('records successful and failed sign-ins with the real failure reason', async () => {
      const token = await signUp('signin-carol');

      await request(server)
        .post('/auth/signin')
        .set('x-request-id', 'req-signin-0001')
        .send({ identifier: 'signin-carol', password: 'wrong-password' });
      await request(server)
        .post('/auth/signin')
        .send({ identifier: 'signin-carol', password: 'secret123' });

      const items = (await trail(token)).filter(
        (i) => i.action === 'auth.signin',
      );
      const failure = items.find((i) => i.outcome === 'failure')!;
      const success = items.find((i) => i.outcome === 'success')!;

      expect(failure.metadata).toMatchObject({
        reason: 'wrong_password',
        method: 'password',
        requestId: 'req-signin-0001',
      });
      expect(success.actorType).toBe('user');
    });

    it('keeps attempts against unknown accounts out of any user’s trail', async () => {
      await request(server)
        .post('/auth/signin')
        .send({ identifier: 'nobody-here', password: 'secret123' });

      const stored = await audit.list('user:nobody-here', 10);
      expect(stored.items).toEqual([]);
    });

    it('records logout and keeps the revoked token', async () => {
      const token = await signUp('logout-dave');
      await request(server).post('/auth/logout').set(bearer(token));

      const relogin = await request(server)
        .post('/auth/signin')
        .send({ identifier: 'logout-dave', password: 'secret123' });
      const items = await trail(tokenOf(relogin));
      expect(items.map((i) => i.action)).toEqual(
        expect.arrayContaining(['auth.logout']),
      );

      expect(
        await dataSource
          .getRepository(RevokedToken)
          .count({ withDeleted: true }),
      ).toBeGreaterThan(0);
    });
  });

  describe('secrets', () => {
    it('never writes password hashes to the log', async () => {
      const token = await signUp('secret-erin');
      await request(server)
        .post('/auth/signin')
        .send({ identifier: 'secret-erin', password: 'secret123' });

      const dump = JSON.stringify(await trail(token));
      expect(dump).toContain('[REDACTED]');
      expect(dump).not.toMatch(/\$2[aby]\$/);
      expect(dump).not.toContain('secret123');
    });
  });

  describe('soft delete', () => {
    it('keeps a removed email, who removed it, and allows re-adding it', async () => {
      const token = await signUp('email-frank');
      const added = await request(server)
        .post('/auth/emails')
        .set(bearer(token))
        .send({ email: 'frank.second@example.com' });
      expect(added.status).toBe(201);
      const emailId = added.body.id as string;

      const removed = await request(server)
        .delete(`/auth/emails/${emailId}`)
        .set(bearer(token));
      expect(removed.status).toBe(200);

      const row = await dataSource
        .getRepository(Email)
        .findOneOrFail({ where: { id: emailId }, withDeleted: true });
      expect(row.deletedAt).toBeInstanceOf(Date);
      expect(row.deletedBy).toBe(await userIdOf(token));

      const listed = await request(server)
        .get('/auth/emails')
        .set(bearer(token));
      expect(listed.body.map((e: { id: string }) => e.id)).not.toContain(
        emailId,
      );

      const readded = await request(server)
        .post('/auth/emails')
        .set(bearer(token))
        .send({ email: 'frank.second@example.com' });
      expect(readded.status).toBe(201);

      const deleted = (await trail(token)).find(
        (i) => i.action === 'email.deleted',
      )!;
      expect(deleted).toMatchObject({ entityId: emailId, actorType: 'user' });
      expect(deleted.changes).toMatchObject({
        before: { email: 'frank.second@example.com' },
      });
    });

    it('audits a primary email switch as field-level changes', async () => {
      const token = await signUp('primary-gina');
      const added = await request(server)
        .post('/auth/emails')
        .set(bearer(token))
        .send({ email: 'gina.alt@example.com' });
      await markEmailVerified(app, 'gina.alt@example.com');
      await request(server)
        .patch(`/auth/emails/${added.body.id}/primary`)
        .set(bearer(token));

      const updates = (await trail(token)).filter(
        (i) => i.action === 'email.updated',
      );
      expect(updates.map((u) => u.changes)).toEqual(
        expect.arrayContaining([
          { fields: { isPrimary: { from: false, to: true } } },
          { fields: { isPrimary: { from: true, to: false } } },
        ]),
      );
      expect((await trail(token)).map((i) => i.action)).toContain(
        'user.updated',
      );
    });

    it('retires expired reject-list entries instead of deleting them', async () => {
      await tokens.revoke('expired-jti-0001', new Date(Date.now() - 1000));
      await tokens.pruneExpired();

      const row = await dataSource.getRepository(RevokedToken).findOneOrFail({
        where: { jti: 'expired-jti-0001' },
        withDeleted: true,
      });
      expect(row.deletedAt).toBeInstanceOf(Date);
    });
  });

  describe('tamper resistance', () => {
    it('refuses hard deletes and audit rewrites at the database', async () => {
      await signUp('tamper-hank');

      await expect(dataSource.query('DELETE FROM emails')).rejects.toThrow(
        /hard deletes are forbidden/,
      );
      await expect(dataSource.query('DELETE FROM users')).rejects.toThrow(
        /hard deletes are forbidden/,
      );
      await expect(
        dataSource.query("UPDATE audit_logs SET outcome = 'success'"),
      ).rejects.toThrow(/append-only/);
      await expect(dataSource.query('DELETE FROM audit_logs')).rejects.toThrow(
        /append-only/,
      );
    });

    it('keeps the hash chain intact across every flow above', async () => {
      const report = await audit.verifyIntegrity();
      expect(report.valid).toBe(true);
      expect(report.checked).toBeGreaterThan(20);
    });
  });
});
