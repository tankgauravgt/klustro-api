import { afterAll } from 'vitest';
import { beforeAll } from 'vitest';
import { describe } from 'vitest';
import { expect } from 'vitest';
import { it } from 'vitest';
import { vi } from 'vitest';
import { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { Server } from 'node:http';

// import applications
import { AuthModule } from '@apps/auth';

// import features
import { PasswordService } from '../../src/trust/services/password.service.js';

// import others
import { oauthSignIn } from './support/oauth.js';
import { withFakeProviders } from './support/oauth.js';
import type { FakeProviders } from './support/oauth.js';
import { tokenOf } from './support/session.js';
import { createVerifiedAccount } from './support/verified-account.js';

async function startApp(env: Record<string, string> = {}) {
  const previous = Object.fromEntries(
    Object.keys(env).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, env);
  const faked = withFakeProviders(
    Test.createTestingModule({ imports: [AuthModule] }),
  );
  const moduleRef = await faked.builder.compile();
  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(0);
  return {
    app,
    fakes: faked.fakes,
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

/**
 * Sign-up is the one endpoint that says whether an address has an account (it asks for that
 * account's password, or refuses a Google/GitHub one). Until mail can carry that answer to the
 * owner instead, probing is made slow (own rate limit), uniform in time (decoy hash) and visible
 * (the owner's audit trail).
 */
describe('Sign-up probing (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let fakes: FakeProviders;
  let restore: () => void;
  let ownerToken: string;
  let socialToken: string;

  const probe = (email: string, overrides: object = {}) =>
    request(server)
      .post('/auth/signup')
      .send({
        username: `prober-${Math.random().toString(36).slice(2, 10)}`,
        firstName: 'Pro',
        lastName: 'Ber',
        email,
        password: 'secret123',
        ...overrides,
      });

  const trail = async (token: string) => {
    const res = await request(server)
      .get('/auth/audit-logs')
      .set(bearer(token));
    return (
      res.body.items as {
        action: string;
        outcome: string;
        metadata: { reason?: string };
      }[]
    ).filter((entry) => entry.action === 'auth.signup.existing_account');
  };

  beforeAll(async () => {
    ({ app, server, fakes, restore } = await startApp());

    ownerToken = await createVerifiedAccount(app, server, {
      username: 'probed-owner',
      email: 'probed-owner@example.com',
      password: 'secret123',
    });

    fakes.profile = {
      provider: 'github',
      providerAccountId: 'probed-social-owner',
      email: 'probed-social@example.com',
      firstName: 'Soc',
      lastName: 'Ial',
    };
    socialToken = tokenOf(await oauthSignIn(server, 'github'));
  });

  afterAll(async () => {
    await app.close();
    restore();
  });

  it('still asks the owner of an account with a password for it', async () => {
    const res = await probe('probed-owner@example.com');

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ status: 'password_required' });
  });

  it('shows the owner that someone asked, with the reason', async () => {
    const entries = await trail(ownerToken);

    expect(entries).toContainEqual(
      expect.objectContaining({
        outcome: 'denied',
        metadata: expect.objectContaining({ reason: 'password_required' }),
      }),
    );
  });

  it('still refuses an address of a Google or GitHub account with 409', async () => {
    const res = await probe('probed-social@example.com');

    expect(res.status).toBe(409);
  });

  it('shows that owner too, even though the request itself was refused', async () => {
    const entries = await trail(socialToken);

    expect(entries).toContainEqual(
      expect.objectContaining({
        outcome: 'denied',
        metadata: expect.objectContaining({ reason: 'social_only_account' }),
      }),
    );
  });

  it('records nothing for an address nobody has', async () => {
    const before = (await trail(ownerToken)).length;

    const res = await probe('nobody-has-this@example.com');

    expect(res.body).toEqual({ status: 'verification_required' });
    expect((await trail(ownerToken)).length).toBe(before);
  });

  it('keeps a wrong password as a failure and does not count it as a probe', async () => {
    const res = await probe('probed-owner@example.com', {
      existingAccountPassword: 'not-the-password',
    });

    expect(res.status).toBe(401);
    const entries = await trail(ownerToken);
    expect(entries).toContainEqual(
      expect.objectContaining({
        outcome: 'failure',
        metadata: expect.objectContaining({ reason: 'wrong_password' }),
      }),
    );
  });

  it('does not tell the asker that anything was recorded', async () => {
    const res = await probe('probed-owner@example.com');

    expect(JSON.stringify(res.body)).toBe('{"status":"password_required"}');
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('spends the cost of hashing a new password on both answers that reveal an account', async () => {
    const decoy = vi.spyOn(PasswordService.prototype, 'verifyDecoy');
    try {
      await probe('probed-owner@example.com');
      await probe('probed-social@example.com');
      expect(decoy).toHaveBeenCalledTimes(2);

      decoy.mockClear();
      await probe('still-nobody@example.com');
      await probe('probed-owner@example.com', {
        existingAccountPassword: 'not-the-password',
      });
      expect(decoy).not.toHaveBeenCalled();
    } finally {
      decoy.mockRestore();
    }
  });

  it('still signs the owner in when they send the right password', async () => {
    const res = await probe('probed-owner@example.com', {
      existingAccountPassword: 'secret123',
    });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('signed_in');
    expect(tokenOf(res)).toBeTruthy();
  });
});

describe('Sign-up has its own, smaller rate limit (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let restore: () => void;

  beforeAll(async () => {
    ({ app, server, restore } = await startApp({
      THROTTLE_LIMIT: '1000',
      SIGNUP_THROTTLE_LIMIT: '2',
    }));
  });

  afterAll(async () => {
    await app.close();
    restore();
  });

  it('answers 429, with when to retry, once the sign-up budget is used', async () => {
    const attempt = (n: number) =>
      request(server)
        .post('/auth/signup')
        .send({
          username: `budget-${n}`,
          firstName: 'Bu',
          lastName: 'Dget',
          email: `budget-${n}@example.com`,
          password: 'secret123',
        });

    const responses = [];
    for (let n = 0; n < 3; n++) {
      responses.push(await attempt(n));
    }

    expect(responses.map((r) => r.status)).toEqual([201, 201, 429]);
    expect(responses[2].headers['retry-after']).toBeDefined();
  });

  it('does not use up the budget of signing in', async () => {
    const statuses = [];
    for (let n = 0; n < 4; n++) {
      const res = await request(server)
        .post('/auth/signin')
        .send({ identifier: 'nobody-here', password: 'whatever-it-is' });
      statuses.push(res.status);
    }

    expect(statuses).toEqual([401, 401, 401, 401]);
  });
});
