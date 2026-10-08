import { Injectable } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';

// import application libraries
import { AppConfigService } from '@libs/common';

// import features
import type { OAuthAuthorizationRequest } from '../../interfaces/access-provider.js';
import type { OAuthCodeExchange } from '../../interfaces/access-provider.js';
import type { OAuthAccessProvider } from '../../interfaces/access-provider.js';
import type { OAuthProfile } from '../../interfaces/oauth-profile.js';

// import services
import { GoogleTokenVerifierService } from './services/google-token-verifier.service.js';

const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

/*
 * Google as a confidential client (authorization code + PKCE + client secret). The code is traded
 * at Google's token endpoint by this server, and the ID token that comes back is verified
 * (signature, audience, `email_verified`) before any of it is believed.
 */
@Injectable()
export class GoogleAccessProvider implements OAuthAccessProvider {
  readonly name = 'google' as const;
  readonly kind = 'oauth' as const;

  constructor(
    private readonly config: AppConfigService,
    private readonly tokenVerifier: GoogleTokenVerifierService,
  ) {}

  authorizationUrl(request: OAuthAuthorizationRequest): string {
    const query = new URLSearchParams({
      client_id: this.config.get('APPS_AUTH__GOOGLE_CLIENT_ID'),
      redirect_uri: request.redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state: request.state,
      code_challenge: request.codeChallenge,
      code_challenge_method: 'S256',
      prompt: 'select_account',
    });
    return `${AUTHORIZE_URL}?${query}`;
  }

  async fetchProfile(exchange: OAuthCodeExchange): Promise<OAuthProfile> {
    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.config.get('APPS_AUTH__GOOGLE_CLIENT_ID'),
        client_secret: this.config.get('APPS_AUTH__GOOGLE_CLIENT_SECRET'),
        code: exchange.code,
        code_verifier: exchange.codeVerifier,
        redirect_uri: exchange.redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    const body = (await response.json().catch(() => ({}))) as {
      id_token?: string;
    };
    if (!response.ok || !body.id_token) {
      throw new UnauthorizedException('Google did not accept the sign-in');
    }

    return this.tokenVerifier.verify(body.id_token);
  }
}
