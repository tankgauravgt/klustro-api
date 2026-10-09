import { afterAll } from 'vitest';
import { beforeAll } from 'vitest';
import { beforeEach } from 'vitest';
import { describe } from 'vitest';
import { expect } from 'vitest';
import { it } from 'vitest';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { Server } from 'node:http';

// import applications
import { AuthModule } from '@apps/auth';

// import others
import { sentMail } from './support/mailgun-stub.js';
import { tokenOf } from './support/session.js';
import { createVerifiedAccount } from './support/verified-account.js';

/** Covers the verification email sent at sign-up and the link that activates the account, and the same for an address added later (Trust). */
describe('Email verification (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let aliceToken: string;

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

    aliceToken = await createVerifiedAccount(app, server, {
      username: 'alice',
      firstName: 'Alice',
      lastName: 'Smith',
      email: 'alice@example.com',
      password: 'secret123',
    });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    sentMail.length = 0;
  });

  const signUpJane = () =>
    request(server).post('/auth/signup').send({
      username: 'jane',
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'jane@example.com',
      password: 'secret123',
    });

  const linkToken = (text: string): string => {
    const match = /verify-email\?token=([0-9a-f]{64})/.exec(text);
    if (!match) {
      throw new Error(`No verification link in mail: ${text}`);
    }
    return match[1];
  };

  it('mails a verification link to the new address', async () => {
    const res = await signUpJane();

    expect(res.status).toBe(201);
    expect(sentMail).toHaveLength(1);
    expect(sentMail[0].to).toBe('"Jane Doe" <jane@example.com>');
    expect(sentMail[0].subject).toBe(
      'Welcome to Klustro - Activate Your Account',
    );
    expect(sentMail[0].text).toContain(
      'http://localhost:3000/verify-email?token=',
    );
  });

  it('refuses to sign in until the link is used', async () => {
    await signUpJane();

    const res = await request(server)
      .post('/auth/signin')
      .send({ identifier: 'jane', password: 'secret123' });

    expect(res.status).toBe(403);
  });

  it('activates the account through the link in the mail', async () => {
    await signUpJane();
    const token = linkToken(sentMail[0].text);

    const verify = await request(server)
      .post('/auth/verify-email')
      .send({ token });
    expect(verify.status).toBe(204);

    const signIn = await request(server)
      .post('/auth/signin')
      .send({ identifier: 'jane', password: 'secret123' });
    expect(signIn.status).toBeLessThan(300);
    expect(tokenOf(signIn)).toBeTruthy();
  });

  it('refuses the same link a second time', async () => {
    await signUpJane();
    const token = linkToken(sentMail[0].text);
    await request(server).post('/auth/verify-email').send({ token });

    const again = await request(server)
      .post('/auth/verify-email')
      .send({ token });

    expect(again.status).toBe(400);
  });

  it('refuses a token that was never issued', async () => {
    const res = await request(server)
      .post('/auth/verify-email')
      .send({ token: 'f'.repeat(64) });

    expect(res.status).toBe(400);
  });

  it('sends no mail when the address already belongs to a verified account', async () => {
    const res = await request(server).post('/auth/signup').send({
      username: 'alice-two',
      firstName: 'Alice',
      lastName: 'Other',
      email: 'alice@example.com',
      password: 'secret123',
    });

    expect(res.body).toEqual({ status: 'password_required' });
    expect(sentMail).toHaveLength(0);
  });

  describe('an address added to a signed-in account', () => {
    const auth = () => ({ Authorization: `Bearer ${aliceToken}` });

    const addEmail = (email: string) =>
      request(server).post('/auth/emails').set(auth()).send({ email });

    const emailsOf = async () =>
      (await request(server).get('/auth/emails').set(auth())).body as {
        id: string;
        email: string;
        isVerified: boolean;
      }[];

    it('mails a verification link to the added address', async () => {
      const res = await addEmail('alice.work@example.com');

      expect(res.status).toBe(201);
      expect(sentMail).toHaveLength(1);
      expect(sentMail[0].to).toBe('"Alice Smith" <alice.work@example.com>');
      expect(sentMail[0].subject).toBe(
        'Confirm your email address for Klustro',
      );
      expect(sentMail[0].text).toContain(
        'http://localhost:3000/verify-email?token=',
      );
    });

    it('verifies only that address when the link is used', async () => {
      await addEmail('alice.home@example.com');
      const token = linkToken(sentMail[0].text);

      const verify = await request(server)
        .post('/auth/verify-email')
        .send({ token });
      expect(verify.status).toBe(204);

      const emails = await emailsOf();
      expect(
        emails.find((e) => e.email === 'alice.home@example.com')?.isVerified,
      ).toBe(true);
      expect(
        emails.find((e) => e.email === 'alice.work@example.com')?.isVerified,
      ).toBe(false);

      const again = await request(server)
        .post('/auth/verify-email')
        .send({ token });
      expect(again.status).toBe(400);
    });

    it('sends a new link on request, and the earlier link stops working', async () => {
      const added = await addEmail('alice.club@example.com');
      const first = linkToken(sentMail[0].text);

      const resend = await request(server)
        .post(`/auth/emails/${added.body.id}/verification`)
        .set(auth());
      expect(resend.status).toBe(204);
      expect(sentMail).toHaveLength(2);
      const second = linkToken(sentMail[1].text);
      expect(second).not.toBe(first);

      const stale = await request(server)
        .post('/auth/verify-email')
        .send({ token: first });
      expect(stale.status).toBe(400);

      const fresh = await request(server)
        .post('/auth/verify-email')
        .send({ token: second });
      expect(fresh.status).toBe(204);
    });

    it('sends nothing more for an address that is already verified', async () => {
      const verified = (await emailsOf()).find(
        (e) => e.email === 'alice@example.com',
      );

      const resend = await request(server)
        .post(`/auth/emails/${verified!.id}/verification`)
        .set(auth());

      expect(resend.status).toBe(204);
      expect(sentMail).toHaveLength(0);
    });

    it('sends nothing for an address that is not on the account', async () => {
      const resend = await request(server)
        .post('/auth/emails/6f1c3a52-8f6e-4c43-9a3e-2f5f1f0c9d11/verification')
        .set(auth());

      expect(resend.status).toBe(204);
      expect(sentMail).toHaveLength(0);
    });

    it('needs a signed-in account to ask for a new link', async () => {
      const res = await request(server).post(
        '/auth/emails/6f1c3a52-8f6e-4c43-9a3e-2f5f1f0c9d11/verification',
      );

      expect(res.status).toBe(401);
    });

    it('mails nothing for an address another account already holds', async () => {
      await signUpJane();
      sentMail.length = 0;

      const res = await addEmail('jane@example.com');

      expect(res.status).toBe(201);
      expect(sentMail).toHaveLength(0);
    });
  });
});
