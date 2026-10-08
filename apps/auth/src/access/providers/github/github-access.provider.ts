import { Injectable } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';

// import application libraries
import { AppConfigService } from '@libs/common';
import { OUTBOUND_REQUEST_TIMEOUT_MS } from '@libs/common';

// import features
import type { OAuthAuthorizationRequest } from '../../interfaces/access-provider.js';
import type { OAuthCodeExchange } from '../../interfaces/access-provider.js';
import type { OAuthAccessProvider } from '../../interfaces/access-provider.js';
import type { OAuthProfile } from '../../interfaces/oauth-profile.js';

// import services
import { GithubTokenVerifierService } from './services/github-token-verifier.service.js';

const AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const TOKEN_URL = 'https://github.com/login/oauth/access_token';

/*
 * GitHub as a confidential client (authorization code + PKCE + client secret). This server trades
 * the code for the access token itself, so the token is always one issued to this app's own
 * client id, and only then is it used to ask GitHub who the person is.
 */
@Injectable()
export class GithubAccessProvider implements OAuthAccessProvider {
  readonly name = 'github' as const;
  readonly kind = 'oauth' as const;

  constructor(
    private readonly config: AppConfigService,
    private readonly profiles: GithubTokenVerifierService,
  ) {}

  authorizationUrl(request: OAuthAuthorizationRequest): string {
    const query = new URLSearchParams({
      client_id: this.config.get('APPS_AUTH__GITHUB_CLIENT_ID'),
      redirect_uri: request.redirectUri,
      scope: 'read:user user:email',
      state: request.state,
      code_challenge: request.codeChallenge,
      code_challenge_method: 'S256',
    });
    return `${AUTHORIZE_URL}?${query}`;
  }

  async fetchProfile(exchange: OAuthCodeExchange): Promise<OAuthProfile> {
    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      signal: AbortSignal.timeout(OUTBOUND_REQUEST_TIMEOUT_MS),
      body: new URLSearchParams({
        client_id: this.config.get('APPS_AUTH__GITHUB_CLIENT_ID'),
        client_secret: this.config.get('APPS_AUTH__GITHUB_CLIENT_SECRET'),
        code: exchange.code,
        code_verifier: exchange.codeVerifier,
        redirect_uri: exchange.redirectUri,
      }),
    });
    // GitHub answers 200 with an `error` field when the code is wrong
    const body = (await response.json().catch(() => ({}))) as {
      access_token?: string;
    };
    if (!response.ok || !body.access_token) {
      throw new UnauthorizedException('GitHub did not accept the sign-in');
    }

    return this.profiles.verify(body.access_token);
  }
}
