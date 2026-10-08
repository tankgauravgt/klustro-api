import { Inject } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import { OAuth2Client } from 'google-auth-library';

// import application libraries
import { AppConfigService } from '@libs/common';

// import features
import { OAuthProfile } from '../../../interfaces/oauth-profile.js';

// import others
import { GOOGLE_OAUTH_CLIENT } from '../constants.js';

/*
 * Verifies the Google ID token this server received from Google's token endpoint: signature,
 * audience (our client id), expiry (against Google's JWKS) and that Google verified the email.
 */
@Injectable()
export class GoogleTokenVerifierService {
  constructor(
    @Inject(GOOGLE_OAUTH_CLIENT) private readonly client: OAuth2Client,
    private readonly config: AppConfigService,
  ) {}

  async verify(idToken: string): Promise<OAuthProfile> {
    let payload;
    try {
      const ticket = await this.client.verifyIdToken({
        idToken,
        audience: this.config.get('APPS_AUTH__GOOGLE_CLIENT_ID'),
      });
      payload = ticket.getPayload();
    } catch {
      throw new UnauthorizedException('Invalid Google ID token');
    }

    if (!payload?.sub || !payload.email) {
      throw new UnauthorizedException(
        'Google ID token is missing required claims',
      );
    }

    if (payload.email_verified !== true) {
      throw new UnauthorizedException(
        'Google has not verified this email address',
      );
    }

    return {
      provider: 'google',
      providerAccountId: payload.sub,
      email: payload.email,
      firstName: payload.given_name ?? null,
      lastName: payload.family_name ?? null,
    };
  }
}
