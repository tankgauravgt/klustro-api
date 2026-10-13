import { randomUUID } from 'node:crypto';
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

// import applications
import { AuthModule } from '@apps/auth';

// import features
import { User } from '../../src/identity/models/user.entity.js';

// import others
import { createVerifiedAccount } from './support/verified-account.js';

// A running app with some settings changed for the length of one describe block
async function startApp(env: Record<string, string> = {}) {
  const previous = Object.fromEntries(
    Object.keys(env).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, env);

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
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    },
  };
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('User lookup (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let restore: () => void;
  let token: string;
  let otherToken: string;

  let named: User;
  let firstOnly: User;
  let unnamed: User;
  let inactive: User;
  let caller: User;

  const lookup = (ids: unknown, auth: string | null = token) => {
    const req = request(server).post('/auth/users/lookup');
    if (auth) req.set(bearer(auth));
    return req.send(ids as object);
  };

  const userByName = (username: string) =>
    app.get(DataSource).getRepository(User).findOneByOrFail({ username });

  const makeUser = async (
    username: string,
    names: { firstName: string | null; lastName: string | null },
  ) => {
    const accessToken = await createVerifiedAccount(app, server, {
      username,
      email: `${username}@example.com`,
      password: 'secret123',
    });
    // Sign-up asks for names; the name variants under test are set straight in the database
    const repo = app.get(DataSource).getRepository(User);
    await repo.update({ username }, names);
    return { accessToken, user: await userByName(username) };
  };

  beforeAll(async () => {
    // Keep the default throttle out of the way; the limit is exercised in its own suite below
    ({ app, server, restore } = await startApp({ THROTTLE_LIMIT: '1000' }));

    const callerAccount = await makeUser('lookup-caller', {
      firstName: 'Cara',
      lastName: 'Caller',
    });
    token = callerAccount.accessToken;
    caller = callerAccount.user;

    named = (
      await makeUser('lookup-named', { firstName: 'Ada', lastName: 'Lovelace' })
    ).user;
    firstOnly = (
      await makeUser('lookup-first-only', {
        firstName: 'Grace',
        lastName: null,
      })
    ).user;
    unnamed = (
      await makeUser('lookup-unnamed', { firstName: null, lastName: null })
    ).user;
    const other = await makeUser('lookup-other', {
      firstName: 'Olive',
      lastName: 'Other',
    });
    otherToken = other.accessToken;

    inactive = (
      await makeUser('lookup-inactive', { firstName: 'In', lastName: 'Active' })
    ).user;
    await app
      .get(DataSource)
      .getRepository(User)
      .update({ id: inactive.id }, { isActive: false });
  });

  afterAll(async () => {
    await app.close();
    restore();
  });

  describe('authentication', () => {
    it('answers 401 without a token', async () => {
      const res = await lookup({ ids: [named.id] }, null);

      expect(res.status).toBe(401);
    });

    it('answers 401 with an invalid token', async () => {
      const res = await lookup({ ids: [named.id] }, 'not-a-real-token');

      expect(res.status).toBe(401);
    });
  });

  describe('results', () => {
    it('answers 200 with id, username and the full name for an active user', async () => {
      const res = await lookup({ ids: [named.id] });

      expect(res.status).toBe(200);
      expect(res.body).toEqual([
        { id: named.id, username: 'lookup-named', displayName: 'Ada Lovelace' },
      ]);
    });

    it('uses the first name alone when there is no last name', async () => {
      const res = await lookup({ ids: [firstOnly.id] });

      expect(res.status).toBe(200);
      expect(res.body).toEqual([
        {
          id: firstOnly.id,
          username: 'lookup-first-only',
          displayName: 'Grace',
        },
      ]);
    });

    it('falls back to the username when there is no name at all', async () => {
      const res = await lookup({ ids: [unnamed.id] });

      expect(res.status).toBe(200);
      expect(res.body).toEqual([
        {
          id: unnamed.id,
          username: 'lookup-unnamed',
          displayName: 'lookup-unnamed',
        },
      ]);
    });

    it('returns several users in one call', async () => {
      const res = await lookup({ ids: [named.id, firstOnly.id, unnamed.id] });

      expect(res.status).toBe(200);
      const byId = new Map(
        (res.body as { id: string; displayName: string }[]).map((card) => [
          card.id,
          card.displayName,
        ]),
      );
      expect(byId.size).toBe(3);
      expect(byId.get(named.id)).toBe('Ada Lovelace');
      expect(byId.get(firstOnly.id)).toBe('Grace');
      expect(byId.get(unnamed.id)).toBe('lookup-unnamed');
    });

    it('lets a user look up another user, and themselves', async () => {
      const asOther = await lookup({ ids: [caller.id] }, otherToken);
      const self = await lookup({ ids: [caller.id] });

      expect(asOther.status).toBe(200);
      expect(asOther.body).toEqual([
        {
          id: caller.id,
          username: 'lookup-caller',
          displayName: 'Cara Caller',
        },
      ]);
      expect(self.body).toEqual(asOther.body);
    });

    it('exposes exactly id, username and displayName and nothing else', async () => {
      const res = await lookup({
        ids: [named.id, firstOnly.id, unnamed.id, caller.id],
      });

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(4);
      for (const card of res.body as Record<string, unknown>[]) {
        expect(Object.keys(card).sort()).toEqual([
          'displayName',
          'id',
          'username',
        ]);
      }
      const raw = JSON.stringify(res.body);
      expect(raw).not.toContain('@example.com');
      expect(raw).not.toContain('passwordHash');
    });

    it('leaves out ids that match no account', async () => {
      const res = await lookup({ ids: [randomUUID(), named.id, randomUUID()] });

      expect(res.status).toBe(200);
      expect(res.body).toEqual([
        { id: named.id, username: 'lookup-named', displayName: 'Ada Lovelace' },
      ]);
    });

    it('answers 200 with an empty list when nothing matches', async () => {
      const res = await lookup({ ids: [randomUUID()] });

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('leaves out deactivated accounts', async () => {
      const only = await lookup({ ids: [inactive.id] });
      const mixed = await lookup({ ids: [inactive.id, named.id] });

      expect(only.status).toBe(200);
      expect(only.body).toEqual([]);
      expect((mixed.body as { id: string }[]).map((card) => card.id)).toEqual([
        named.id,
      ]);
    });
  });

  describe('validation', () => {
    it('rejects a body without ids', async () => {
      const res = await lookup({});

      expect(res.status).toBe(400);
    });

    it('rejects an empty list', async () => {
      const res = await lookup({ ids: [] });

      expect(res.status).toBe(400);
    });

    it('accepts 100 ids and rejects 101', async () => {
      const ids = Array.from({ length: 101 }, () => randomUUID());

      const atLimit = await lookup({ ids: ids.slice(0, 100) });
      const over = await lookup({ ids });

      expect(atLimit.status).toBe(200);
      expect(atLimit.body).toEqual([]);
      expect(over.status).toBe(400);
    });

    it('rejects ids that are not UUIDs', async () => {
      const res = await lookup({ ids: [named.id, 'not-a-uuid'] });

      expect(res.status).toBe(400);
    });

    it('rejects non-string ids', async () => {
      const res = await lookup({ ids: [123, null] });

      expect(res.status).toBe(400);
    });

    it('rejects duplicate ids', async () => {
      const res = await lookup({ ids: [named.id, named.id] });

      expect(res.status).toBe(400);
    });

    it('rejects ids that are not an array', async () => {
      const asString = await lookup({ ids: named.id });
      const asObject = await lookup({ ids: { 0: named.id } });

      expect(asString.status).toBe(400);
      expect(asObject.status).toBe(400);
    });

    it('strips fields that are not part of the contract', async () => {
      const res = await lookup({
        ids: [named.id],
        isActive: false,
        email: 'someone@example.com',
      });

      expect(res.status).toBe(200);
      expect(res.body).toEqual([
        { id: named.id, username: 'lookup-named', displayName: 'Ada Lovelace' },
      ]);
    });
  });
});

describe('User lookup is rate limited (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let restore: () => void;

  beforeAll(async () => {
    ({ app, server, restore } = await startApp({ THROTTLE_LIMIT: '3' }));
  });

  afterAll(async () => {
    await app.close();
    restore();
  });

  it('allows the configured number of lookups, then answers 429', async () => {
    // Each route has its own budget, so making the account does not use up the one under test
    const token = await createVerifiedAccount(app, server, {
      username: 'lookup-limited',
      email: 'lookup-limited@example.com',
      password: 'secret123',
    });

    const statuses = [];
    for (let n = 0; n < 5; n++) {
      const res = await request(server)
        .post('/auth/users/lookup')
        .set(bearer(token))
        .send({ ids: [randomUUID()] });
      statuses.push(res.status);
    }

    expect(statuses).toEqual([200, 200, 200, 429, 429]);
  });
});
