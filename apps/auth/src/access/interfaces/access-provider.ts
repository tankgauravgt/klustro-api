// import models
import type { OAuthProvider } from '../../identity/models/oauth-account.entity.js';

// import interfaces
import type { OAuthProfile } from './oauth-profile.js';

export type AccessProviderName = 'local' | OAuthProvider;

// Every way of signing in is an access provider: `credentials` ones take a password in the
// request, `oauth` ones send the person to the provider and are completed by its callback.
export interface AccessProvider {
  readonly name: AccessProviderName;
  readonly kind: 'credentials' | 'oauth';
}

export interface OAuthAuthorizationRequest {
  redirectUri: string;
  state: string;
  codeChallenge: string;
}

export interface OAuthCodeExchange {
  code: string;
  redirectUri: string;
  codeVerifier: string;
}

// A confidential client: the API holds the client secret and trades the code for the identity
export interface OAuthAccessProvider extends AccessProvider {
  readonly name: OAuthProvider;
  readonly kind: 'oauth';
  authorizationUrl(request: OAuthAuthorizationRequest): string;
  fetchProfile(exchange: OAuthCodeExchange): Promise<OAuthProfile>;
}
