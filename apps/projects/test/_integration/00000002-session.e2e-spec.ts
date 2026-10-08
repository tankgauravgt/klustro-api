import { afterAll } from 'vitest';
import { beforeAll } from 'vitest';
import { beforeEach } from 'vitest';
import { describe } from 'vitest';
import { expect } from 'vitest';
import { it } from 'vitest';
import { INestApplication } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { Server } from 'node:http';

// import application libraries
import { AppConfigService } from '@libs/common';

// import applications
import { ProjectsModule } from '@apps/projects';
import { AuthSessionService } from '../../src/identity/index.js';

/**
 * The projects service asks the auth service about every token. The auth service is faked here,
 * so these tests cover only what projects does with the answer.
 */
describe('Projects session check (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let token: string;
  let calls: string[];
  let answer: 'valid' | 'revoked' | 'down';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ProjectsModule],
    })
      .overrideProvider(AuthSessionService)
      .useValue({
        verify: async (sent: string) => {
          calls.push(sent);
          if (answer === 'revoked') throw new UnauthorizedException();
          if (answer === 'down') throw new Error('unreachable');
          return { id: 'user-1' };
        },
      })
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.listen(0);
    server = app.getHttpServer();
    token = new JwtService({
      secret: moduleRef.get(AppConfigService).get('JWT_SECRET'),
    }).sign({ sub: 'user-1' });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    calls = [];
    answer = 'valid';
  });

  it('asks the auth service on every request', async () => {
    await request(server)
      .get('/projects')
      .set('Authorization', `Bearer ${token}`);
    await request(server)
      .get('/projects')
      .set('Authorization', `Bearer ${token}`);

    expect(calls).toEqual([token, token]);
  });

  it('accepts the session cookie as well as a Bearer header', async () => {
    const res = await request(server)
      .get('/projects')
      .set('Cookie', `access_token=${token}`);

    expect(res.status).toBe(200);
    expect(calls).toEqual([token]);
  });

  it('rejects a token the auth service no longer accepts', async () => {
    answer = 'revoked';

    const res = await request(server)
      .get('/projects')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(401);
  });

  it('does not ask the auth service about a forged token', async () => {
    const forged = new JwtService({ secret: 'wrong' }).sign({ sub: 'user-1' });

    const res = await request(server)
      .get('/projects')
      .set('Authorization', `Bearer ${forged}`);

    expect(res.status).toBe(401);
    expect(calls).toEqual([]);
  });

  it('fails closed when the auth service cannot be reached', async () => {
    answer = 'down';

    const res = await request(server)
      .get('/projects')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBeGreaterThanOrEqual(401);
    expect(res.status).not.toBe(200);
  });

  it('rejects a request with no token without asking', async () => {
    const res = await request(server).get('/projects');

    expect(res.status).toBe(401);
    expect(calls).toEqual([]);
  });
});
