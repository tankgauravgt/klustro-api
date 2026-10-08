import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import type { Server } from 'node:http';

// import others
import { tokenOf } from './session.js';

// import features
import { Email } from '../../../src/identity/models/email.entity.js';
import { User } from '../../../src/identity/models/user.entity.js';

export interface NewAccount {
  username: string;
  firstName?: string;
  lastName?: string;
  email: string;
  password: string;
}

// Verifies the address directly in the database, skipping the mailed link
export async function markEmailVerified(
  app: INestApplication,
  address: string,
): Promise<void> {
  const dataSource = app.get(DataSource);
  const email = await dataSource
    .getRepository(Email)
    .findOneByOrFail({ email: address });
  await dataSource
    .getRepository(Email)
    .update({ id: email.id }, { isVerified: true });
  await dataSource
    .getRepository(User)
    .update({ id: email.userId }, { isEmailVerified: true });
}

// Signs up, verifies the email, signs in: returns a usable access token
export async function createVerifiedAccount(
  app: INestApplication,
  server: Server,
  account: NewAccount,
): Promise<string> {
  const signUp = await request(server)
    .post('/auth/signup')
    .send({ firstName: 'Test', lastName: 'User', ...account });
  if (signUp.body.status !== 'verification_required') {
    throw new Error(
      `Sign-up did not create a pending account: ${JSON.stringify(signUp.body)}`,
    );
  }

  await markEmailVerified(app, account.email.toLowerCase());

  const signIn = await request(server)
    .post('/auth/signin')
    .send({ identifier: account.username, password: account.password });
  return tokenOf(signIn);
}
