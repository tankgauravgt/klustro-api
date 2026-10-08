import { describe } from 'vitest';
import { expect } from 'vitest';
import { it } from 'vitest';
import { vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';

// import application libraries
import { AppConfigService } from '@libs/common';

// import services
import { GoogleTokenVerifierService } from '../../../../../src/access/providers/google/services/google-token-verifier.service.js';

const CLIENT_ID = 'configured-client.apps.googleusercontent.com';

function setup(payload: object | null | 'throws') {
  const verifyIdToken = vi.fn(async () => {
    if (payload === 'throws') throw new Error('bad token');
    return { getPayload: () => payload };
  });
  const config = new AppConfigService(
    new ConfigService({ APPS_AUTH__GOOGLE_CLIENT_ID: CLIENT_ID }),
  );
  const service = new GoogleTokenVerifierService(
    { verifyIdToken } as unknown as OAuth2Client,
    config,
  );
  return { service, verifyIdToken };
}

describe('GoogleTokenVerifierService', () => {
  it('checks the token against the configured client id', async () => {
    const { service, verifyIdToken } = setup({
      sub: '1',
      email: 'a@b.c',
      email_verified: true,
    });

    await service.verify('the-token');

    expect(verifyIdToken).toHaveBeenCalledWith({
      idToken: 'the-token',
      audience: CLIENT_ID,
    });
  });

  it('maps the verified claims to an OAuth profile', async () => {
    const { service } = setup({
      sub: 'google-123',
      email: 'jane@example.com',
      email_verified: true,
      given_name: 'Jane',
      family_name: 'Doe',
    });

    expect(await service.verify('t')).toEqual({
      provider: 'google',
      providerAccountId: 'google-123',
      email: 'jane@example.com',
      firstName: 'Jane',
      lastName: 'Doe',
    });
  });

  it('allows missing name claims', async () => {
    const { service } = setup({
      sub: '1',
      email: 'a@b.c',
      email_verified: true,
    });

    expect(await service.verify('t')).toMatchObject({
      firstName: null,
      lastName: null,
    });
  });

  it('rejects a token Google refuses to verify', async () => {
    const { service } = setup('throws');

    await expect(service.verify('t')).rejects.toThrow(UnauthorizedException);
  });

  it.each([
    ['no payload', null],
    ['no subject', { email: 'a@b.c' }],
    ['no email', { sub: '1' }],
  ])('rejects a token with %s', async (_label, payload) => {
    const { service } = setup(payload);

    await expect(service.verify('t')).rejects.toThrow(
      /missing required claims/,
    );
  });

  it.each([
    ['false', { sub: '1', email: 'a@b.c', email_verified: false }],
    ['missing', { sub: '1', email: 'a@b.c' }],
  ])(
    'refuses an email Google has not verified (%s)',
    async (_label, payload) => {
      const { service } = setup(payload);

      await expect(service.verify('t')).rejects.toThrow(/not verified/);
    },
  );
});
