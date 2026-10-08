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
import { tokenOf } from './support/session.js';

describe('Session cookie (e2e)', () => {
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
      username: 'cookie-carl',
      email: 'carl@example.com',
      password: 'secret123',
    });
  });

  afterAll(async () => {
    await app.close();
  });

  const signIn = () =>
    request(server)
      .post('/auth/signin')
      .send({ identifier: 'cookie-carl', password: 'secret123' });

  it('sets the token as an httpOnly, Secure, SameSite=Strict cookie', async () => {
    const res = await signIn();

    const cookie = (res.headers['set-cookie'] as unknown as string[]).find(
      (c) => c.startsWith('access_token='),
    )!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).toMatch(/Path=\//);
  });

  it('keeps the token out of the response body', async () => {
    const res = await signIn();

    expect(res.body.accessToken).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain(tokenOf(res));
    expect(res.body.requiresPasswordSetup).toBe(false);
  });

  it('authenticates a request that carries only the cookie', async () => {
    const token = tokenOf(await signIn());

    const res = await request(server)
      .get('/auth/me')
      .set('Cookie', `access_token=${token}`);

    expect(res.status).toBe(200);
    expect(res.body.username).toBe('cookie-carl');
  });

  it('checks a token for other services at GET /auth/session', async () => {
    const token = tokenOf(await signIn());

    const ok = await request(server)
      .get('/auth/session')
      .set('Cookie', `access_token=${token}`);
    expect(ok.status).toBe(200);
    expect(ok.body.id).toBeTypeOf('string');

    expect((await request(server).get('/auth/session')).status).toBe(401);
  });

  it('clears the cookie on logout, and the old token stops working', async () => {
    const token = tokenOf(await signIn());

    const res = await request(server)
      .post('/auth/logout')
      .set('Cookie', `access_token=${token}`);

    expect(res.status).toBe(204);
    const cleared = (res.headers['set-cookie'] as unknown as string[]).find(
      (c) => c.startsWith('access_token='),
    )!;
    expect(cleared).toMatch(/access_token=;/);
    expect(cleared).toMatch(/Expires=Thu, 01 Jan 1970/);
    const after = await request(server)
      .get('/auth/session')
      .set('Cookie', `access_token=${token}`);
    expect(after.status).toBe(401);
  });

  it('refreshes the cookie when a password is set', async () => {
    const token = tokenOf(await signIn());

    const res = await request(server)
      .patch('/auth/password/set')
      .set('Cookie', `access_token=${token}`)
      .send({ password: 'another-secret1', currentPassword: 'secret123' });

    expect(res.body.accessToken).toBeUndefined();
    expect(tokenOf(res)).not.toBe(token);
  });

  it('rejects a garbage cookie', async () => {
    const res = await request(server)
      .get('/auth/me')
      .set('Cookie', 'access_token=not-a-jwt');

    expect(res.status).toBe(401);
  });
});
