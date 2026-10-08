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

/** Changing a password needs the current one, so guesses of it are limited like sign-in attempts. */
describe('Password change guesses (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let token: string;
  const previousLimit = process.env['THROTTLE_LIMIT'];

  beforeAll(async () => {
    process.env['THROTTLE_LIMIT'] = '3';
    const moduleRef = await Test.createTestingModule({
      imports: [AuthModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.listen(0);
    server = app.getHttpServer();
    // Each route has its own budget, so making the account does not use up the one under test
    token = await createVerifiedAccount(app, server, {
      username: 'guess-limited',
      email: 'guess-limited@example.com',
      password: 'secret123',
    });
  });

  afterAll(async () => {
    process.env['THROTTLE_LIMIT'] = previousLimit;
    await app.close();
  });

  it('answers 429 after the configured number of attempts', async () => {
    const statuses = [];
    for (let i = 0; i < 4; i++) {
      statuses.push(
        (
          await request(server)
            .patch('/auth/password/set')
            .set('Authorization', `Bearer ${token}`)
            .send({
              password: 'brand-new-pass1',
              currentPassword: `guess-${i}`,
            })
        ).status,
      );
    }

    expect(statuses).toEqual([400, 400, 400, 429]);
  });
});
