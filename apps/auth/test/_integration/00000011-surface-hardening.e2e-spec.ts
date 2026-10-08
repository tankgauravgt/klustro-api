import { randomUUID } from 'node:crypto';
import { afterAll } from 'vitest';
import { beforeAll } from 'vitest';
import { describe } from 'vitest';
import { expect } from 'vitest';
import { it } from 'vitest';
import { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import request from 'supertest';
import type { Server } from 'node:http';

// import application libraries
import { AppConfigService } from '@libs/common';
import { applyTrustProxy } from '@libs/common';

// import applications
import { AuthModule } from '@apps/auth';

// import features
import { User } from '../../src/identity/models/user.entity.js';

// import others
import { finishLogin } from './support/oauth.js';
import { withFakeProviders } from './support/oauth.js';
import type { FakeProviders } from './support/oauth.js';
import { createVerifiedAccount } from './support/verified-account.js';

// A running app with some settings changed for the length of one describe block
async function startApp(
  env: Record<string, string> = {},
  options: { fakeProviders?: boolean; trustProxy?: boolean } = {},
) {
  const previous = Object.fromEntries(
    Object.keys(env).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, env);

  let builder = Test.createTestingModule({ imports: [AuthModule] });
  let fakes: FakeProviders | undefined;
  if (options.fakeProviders) {
    const faked = withFakeProviders(builder);
    builder = faked.builder;
    fakes = faked.fakes;
  }
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  if (options.trustProxy) {
    applyTrustProxy(app, moduleRef.get(AppConfigService));
  }
  await app.listen(0);

  return {
    app,
    fakes,
    server: app.getHttpServer() as Server,
    secret: moduleRef.get(AppConfigService).get('JWT_SECRET'),
    restore: () => {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    },
  };
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

const signInWith = (server: Server, ip: string, identifier = 'nobody-here') =>
  request(server)
    .post('/auth/signin')
    .set('X-Forwarded-For', ip)
    .send({ identifier, password: 'whatever-it-is' });

describe('API surface hardening (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let fakes: FakeProviders;
  let secret: string;
  let restore: () => void;

  beforeAll(async () => {
    const started = await startApp({}, { fakeProviders: true });
    ({ app, server, secret, restore } = started);
    fakes = started.fakes!;
  });

  afterAll(async () => {
    await app.close();
    restore();
  });

  const addEmail = (token: string, email: string) =>
    request(server).post('/auth/emails').set(bearer(token)).send({ email });

  const auditActions = async (token: string) => {
    const res = await request(server)
      .get('/auth/audit-logs')
      .set(bearer(token));
    return res.body.items as { action: string; outcome: string }[];
  };

  describe('access token algorithm', () => {
    it('accepts a token signed with HS256 and rejects the same one signed with another algorithm', async () => {
      const token = await createVerifiedAccount(app, server, {
        username: 'alg-user',
        email: 'alg-user@example.com',
        password: 'secret123',
      });
      const user = await app
        .get(DataSource)
        .getRepository(User)
        .findOneByOrFail({ username: 'alg-user' });
      const payload = {
        sub: user.id,
        jti: randomUUID(),
        tokenVersion: user.tokenVersion,
      };
      const jwt = new JwtService({ secret });

      const control = await request(server)
        .get('/auth/me')
        .set(
          bearer(jwt.sign(payload, { algorithm: 'HS256', expiresIn: '1h' })),
        );
      const hs384 = await request(server)
        .get('/auth/me')
        .set(
          bearer(jwt.sign(payload, { algorithm: 'HS384', expiresIn: '1h' })),
        );
      const hs512 = await request(server)
        .get('/auth/me')
        .set(
          bearer(jwt.sign(payload, { algorithm: 'HS512', expiresIn: '1h' })),
        );

      expect(token).toBeTruthy();
      expect(control.status).toBe(200);
      expect(hs384.status).toBe(401);
      expect(hs512.status).toBe(401);
    });

    it('rejects an unsigned token', async () => {
      const part = (value: object) =>
        Buffer.from(JSON.stringify(value)).toString('base64url');
      const unsigned = `${part({ alg: 'none', typ: 'JWT' })}.${part({
        sub: randomUUID(),
        jti: randomUUID(),
        tokenVersion: 0,
        exp: Math.floor(Date.now() / 1000) + 3600,
      })}.`;

      const res = await request(server).get('/auth/me').set(bearer(unsigned));

      expect(res.status).toBe(401);
    });
  });

  describe('email ids', () => {
    it('answers 400 to an id that is not a UUID, and 404 to a UUID nobody has', async () => {
      const token = await createVerifiedAccount(app, server, {
        username: 'uuid-user',
        email: 'uuid-user@example.com',
        password: 'secret123',
      });

      const primary = await request(server)
        .patch('/auth/emails/not-a-uuid/primary')
        .set(bearer(token));
      const remove = await request(server)
        .delete('/auth/emails/not-a-uuid')
        .set(bearer(token));
      const unknown = await request(server)
        .delete(`/auth/emails/${randomUUID()}`)
        .set(bearer(token));

      expect(primary.status).toBe(400);
      expect(remove.status).toBe(400);
      expect(unknown.status).toBe(404);
    });
  });

  describe('GET /auth/connections', () => {
    it('lists only the id, the provider and when it was connected', async () => {
      const token = await createVerifiedAccount(app, server, {
        username: 'connections-user',
        email: 'connections-user@example.com',
        password: 'secret123',
      });
      fakes.profile = {
        provider: 'github',
        providerAccountId: 'the-providers-own-id',
        email: 'connections-user@example.com',
        firstName: 'Con',
        lastName: 'Nection',
      };
      const start = await request(server)
        .get('/auth/github/connect')
        .set(bearer(token))
        .redirects(0);
      await finishLogin(server, 'github', start);

      const res = await request(server)
        .get('/auth/connections')
        .set(bearer(token));

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(Object.keys(res.body[0]).sort()).toEqual([
        'connectedAt',
        'id',
        'provider',
      ]);
      expect(res.body[0].provider).toBe('github');
      expect(JSON.stringify(res.body)).not.toContain('the-providers-own-id');
      expect(Number.isNaN(Date.parse(res.body[0].connectedAt))).toBe(false);
    });
  });

  describe('POST /auth/emails', () => {
    let holder: string;
    let asker: string;

    beforeAll(async () => {
      holder = await createVerifiedAccount(app, server, {
        username: 'email-holder',
        email: 'email-holder@example.com',
        password: 'secret123',
      });
      asker = await createVerifiedAccount(app, server, {
        username: 'email-asker',
        email: 'email-asker@example.com',
        password: 'secret123',
      });
    });

    it('answers an address another account holds exactly like a free one', async () => {
      const free = await addEmail(asker, 'free-address@example.com');
      const held = await addEmail(asker, 'email-holder@example.com');

      expect(free.status).toBe(201);
      expect(held.status).toBe(201);
      expect(Object.keys(held.body).sort()).toEqual(
        Object.keys(free.body).sort(),
      );
      expect(held.body).toMatchObject({
        email: 'email-holder@example.com',
        isPrimary: false,
        isVerified: false,
        providedBy: null,
      });
    });

    it('adds the free address and nothing for the held one', async () => {
      const res = await request(server).get('/auth/emails').set(bearer(asker));

      expect(res.body.map((e: { email: string }) => e.email).sort()).toEqual([
        'email-asker@example.com',
        'free-address@example.com',
      ]);
    });

    it("leaves the holder's address with the holder", async () => {
      const res = await request(server).get('/auth/emails').set(bearer(holder));

      expect(res.body).toHaveLength(1);
      expect(res.body[0]).toMatchObject({
        email: 'email-holder@example.com',
        isPrimary: true,
        isVerified: true,
      });
    });

    it('shows the attempt to the holder and not to the asker', async () => {
      const holders = await auditActions(holder);
      const askers = await auditActions(asker);

      expect(holders).toContainEqual(
        expect.objectContaining({
          action: 'auth.email.add_blocked',
          outcome: 'denied',
        }),
      );
      expect(askers.map((entry) => entry.action)).not.toContain(
        'auth.email.add_blocked',
      );
    });

    it('still answers 409 when the address is already on your own account', async () => {
      const res = await addEmail(asker, 'free-address@example.com');

      expect(res.status).toBe(409);
      expect(res.body.message).toBe('Email already in use');
    });

    it('stops at 10 addresses per account, whoever holds the one asked for', async () => {
      const capped = await createVerifiedAccount(app, server, {
        username: 'email-capped',
        email: 'email-capped@example.com',
        password: 'secret123',
      });
      for (let n = 1; n < 10; n++) {
        const res = await addEmail(capped, `capped-${n}@example.com`);
        expect(res.status).toBe(201);
      }

      const free = await addEmail(capped, 'one-too-many@example.com');
      const held = await addEmail(capped, 'email-holder@example.com');

      expect(free.status).toBe(400);
      expect(held.status).toBe(400);
      expect(held.body.message).toBe(free.body.message);
    });
  });
});

describe('Adding emails is rate limited (e2e)', () => {
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

  it('allows the configured number of additions, then answers 429', async () => {
    const token = await createVerifiedAccount(app, server, {
      username: 'email-limited',
      email: 'email-limited@example.com',
      password: 'secret123',
    });

    const statuses = [];
    for (let n = 0; n < 5; n++) {
      const res = await request(server)
        .post('/auth/emails')
        .set(bearer(token))
        .send({ email: `limited-${n}@example.com` });
      statuses.push(res.status);
    }

    expect(statuses).toEqual([201, 201, 201, 429, 429]);
  });
});

describe('Behind a proxy (TRUST_PROXY) (e2e)', () => {
  describe('when told to trust one proxy', () => {
    let app: INestApplication;
    let server: Server;
    let restore: () => void;

    beforeAll(async () => {
      ({ app, server, restore } = await startApp(
        { TRUST_PROXY: '1', THROTTLE_LIMIT: '2' },
        { trustProxy: true },
      ));
    });

    afterAll(async () => {
      await app.close();
      restore();
    });

    it('rate limits each client address the proxy reports on its own', async () => {
      const first = [];
      for (let n = 0; n < 3; n++) {
        first.push((await signInWith(server, '198.51.100.1')).status);
      }
      const other = await signInWith(server, '198.51.100.2');

      expect(first).toEqual([401, 401, 429]);
      expect(other.status).toBe(401);
    });

    it("records the client's address in the audit trail, not the proxy's", async () => {
      await createVerifiedAccount(app, server, {
        username: 'proxied',
        email: 'proxied@example.com',
        password: 'secret123',
      });
      const signIn = await request(server)
        .post('/auth/signin')
        .set('X-Forwarded-For', '203.0.113.9')
        .send({ identifier: 'proxied', password: 'secret123' });
      const token = decodeURIComponent(
        (signIn.headers['set-cookie'] as unknown as string[])
          .find((c) => c.startsWith('access_token='))!
          .split(';')[0]
          .slice('access_token='.length),
      );

      const res = await request(server)
        .get('/auth/audit-logs')
        .set(bearer(token));

      const signins = res.body.items.filter(
        (entry: { action: string }) => entry.action === 'auth.signin',
      );
      expect(signins[0].metadata.ip).toBe('203.0.113.9');
    });
  });

  describe('when not told to trust a proxy (the default)', () => {
    let app: INestApplication;
    let server: Server;
    let restore: () => void;

    beforeAll(async () => {
      ({ app, server, restore } = await startApp({
        TRUST_PROXY: '0',
        THROTTLE_LIMIT: '2',
      }));
    });

    afterAll(async () => {
      await app.close();
      restore();
    });

    it('ignores X-Forwarded-For, so a client cannot dodge the limit by changing it', async () => {
      const statuses = [];
      for (const ip of ['198.51.100.1', '198.51.100.2', '198.51.100.3']) {
        statuses.push((await signInWith(server, ip)).status);
      }

      expect(statuses).toEqual([401, 401, 429]);
    });
  });
});
