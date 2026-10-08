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
import { isDatabaseSerialized } from '@libs/common';
import { AuditService } from '@libs/governance';

// import applications
import { AuthModule } from '@apps/auth';

// import features
import { Email } from '../../src/identity/models/email.entity.js';
import { User } from '../../src/identity/models/user.entity.js';

// import others
import { createVerifiedAccount } from './support/verified-account.js';

async function startApp(flag: '0' | '1') {
  const previous = process.env['USE_SQLITE_DATABASE'];
  process.env['USE_SQLITE_DATABASE'] = flag;
  const moduleRef = await Test.createTestingModule({
    imports: [AuthModule],
  }).compile();
  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(0);
  return {
    app,
    server: app.getHttpServer() as Server,
    restore: () => {
      if (previous === undefined) delete process.env['USE_SQLITE_DATABASE'];
      else process.env['USE_SQLITE_DATABASE'] = previous;
    },
  };
}

/**
 * USE_SQLITE_DATABASE=1: SQLite has one connection that every request shares, so database work
 * takes turns (libs/common/src/database/transaction-gate.ts). Requests that race here must each get
 * a clean answer and must not undo each other's writes.
 */
describe('Database serialization on (USE_SQLITE_DATABASE=1) (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let restore: () => void;

  const signUp = (n: number, overrides: object = {}) =>
    request(server)
      .post('/auth/signup')
      .send({
        username: `serial-${n}`,
        firstName: 'Se',
        lastName: 'Rial',
        email: `serial-${n}@example.com`,
        password: 'secret123',
        ...overrides,
      });

  beforeAll(async () => {
    ({ app, server, restore } = await startApp('1'));
  });

  afterAll(async () => {
    await app.close();
    restore();
  });

  it('is switched on', () => {
    expect(isDatabaseSerialized(app.get(DataSource))).toBe(true);
  });

  it('answers 409, not 500, to the sign-up that loses a race for a username', async () => {
    const responses = await Promise.all([
      signUp(1, { username: 'raced-name', email: 'raced-a@example.com' }),
      signUp(2, { username: 'raced-name', email: 'raced-b@example.com' }),
    ]);

    expect(responses.map((r) => r.status).sort((a, b) => a - b)).toEqual([
      201, 409,
    ]);
    const owners = await app
      .get(DataSource)
      .getRepository(User)
      .countBy({ username: 'raced-name' });
    expect(owners).toBe(1);
  });

  it('answers 409, not 500, to the sign-up that loses a race for an email', async () => {
    const responses = await Promise.all([
      signUp(3, { email: 'raced-email@example.com' }),
      signUp(4, { email: 'raced-email@example.com' }),
    ]);

    const statuses = responses.map((r) => r.status).sort((a, b) => a - b);
    // One creates the account; the other either loses the race or replaces the still-unverified one
    expect(statuses[0]).toBe(201);
    expect(statuses[1]).not.toBe(500);
    const holders = await app
      .get(DataSource)
      .getRepository(Email)
      .countBy({ email: 'raced-email@example.com' });
    expect(holders).toBe(1);
  });

  it('keeps every sign-up that succeeded when a racing one fails', async () => {
    const [first, second, clash, third, fourth] = await Promise.all([
      signUp(10),
      signUp(11),
      // Wants the username of the first; whichever of the two is handled first keeps it
      signUp(12, { username: 'serial-10', email: 'serial-12@example.com' }),
      signUp(13),
      signUp(14),
    ]);

    expect([second, third, fourth].map((r) => r.status)).toEqual([
      201, 201, 201,
    ]);
    expect([first.status, clash.status].sort((a, b) => a - b)).toEqual([
      201, 409,
    ]);

    const users = app.get(DataSource).getRepository(User);
    expect(await users.countBy({ username: 'serial-10' })).toBe(1);
    for (const name of ['serial-11', 'serial-13', 'serial-14']) {
      expect(await users.countBy({ username: name })).toBe(1);
    }
    // The one that lost left nothing behind, not even its email
    const emails = app.get(DataSource).getRepository(Email);
    const loserEmail = first.status === 201 ? 'serial-12' : 'serial-10';
    expect(await emails.countBy({ email: `${loserEmail}@example.com` })).toBe(
      0,
    );
  });

  it('answers 409 to the email address added twice at once', async () => {
    const token = await createVerifiedAccount(app, server, {
      username: 'serial-adder',
      email: 'serial-adder@example.com',
      password: 'secret123',
    });
    const add = () =>
      request(server)
        .post('/auth/emails')
        .set('Authorization', `Bearer ${token}`)
        .send({ email: 'serial-extra@example.com' });

    const responses = await Promise.all([add(), add()]);

    expect(responses.map((r) => r.status).sort((a, b) => a - b)).toEqual([
      201, 409,
    ]);
  });

  it("a read in the middle of other requests' transactions still answers", async () => {
    const token = await createVerifiedAccount(app, server, {
      username: 'serial-reader',
      email: 'serial-reader@example.com',
      password: 'secret123',
    });

    const responses = await Promise.all([
      signUp(20),
      request(server).get('/auth/me').set('Authorization', `Bearer ${token}`),
      signUp(21),
      request(server)
        .get('/auth/emails')
        .set('Authorization', `Bearer ${token}`),
    ]);

    expect(responses.map((r) => r.status)).toEqual([201, 200, 201, 200]);
  });

  it('leaves the audit trail unbroken after all that', async () => {
    const report = await app.get(AuditService).verifyIntegrity();

    expect(report.valid).toBe(true);
    expect(report.checked).toBeGreaterThan(0);
  });
});

describe('Database serialization off (USE_SQLITE_DATABASE=0) (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let restore: () => void;

  beforeAll(async () => {
    ({ app, server, restore } = await startApp('0'));
  });

  afterAll(async () => {
    await app.close();
    restore();
  });

  it('leaves the database access as it is', () => {
    expect(isDatabaseSerialized(app.get(DataSource))).toBe(false);
  });

  it('still serves requests', async () => {
    const res = await request(server).get('/auth/providers');

    expect(res.status).toBe(200);
  });
});
