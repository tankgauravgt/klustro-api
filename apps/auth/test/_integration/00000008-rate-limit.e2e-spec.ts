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

/** The limit comes from `.env`; this suite runs with a tiny one so it can be reached. */
describe('Rate limiting (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  const previousLimit = process.env['THROTTLE_LIMIT'];
  const previousSignUpLimit = process.env['SIGNUP_THROTTLE_LIMIT'];

  beforeAll(async () => {
    process.env['THROTTLE_LIMIT'] = '3';
    process.env['SIGNUP_THROTTLE_LIMIT'] = '3';
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
    process.env['THROTTLE_LIMIT'] = previousLimit;
    process.env['SIGNUP_THROTTLE_LIMIT'] = previousSignUpLimit;
    await app.close();
  });

  it('allows the configured number of password sign-ins, then answers 429', async () => {
    const attempt = () =>
      request(server)
        .post('/auth/signin')
        .send({ identifier: 'nobody', password: 'wrong-password' });

    const statuses = [];
    for (let i = 0; i < 5; i++) {
      statuses.push((await attempt()).status);
    }

    expect(statuses).toEqual([401, 401, 401, 429, 429]);
  });

  it('gives sign-up (and the password step behind it) its own budget', async () => {
    const attempt = (n: number) =>
      request(server)
        .post('/auth/signup')
        .send({
          username: `limited-${n}`,
          firstName: 'L',
          lastName: 'M',
          email: `limited-${n}@example.com`,
          password: 'secret123',
        });

    const statuses = [];
    for (let i = 0; i < 4; i++) {
      statuses.push((await attempt(i)).status);
    }

    expect(statuses).toEqual([201, 201, 201, 429]);
  });

  it('limits starting an OAuth sign-in too', async () => {
    const statuses = [];
    for (let i = 0; i < 4; i++) {
      statuses.push((await request(server).get('/auth/github/login')).status);
    }

    expect(statuses).toEqual([302, 302, 302, 429]);
  });
});
