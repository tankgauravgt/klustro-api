import { Injectable } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash } from 'node:crypto';
import { randomBytes } from 'node:crypto';
import { timingSafeEqual } from 'node:crypto';

// import application libraries
import { AppConfigService } from '@libs/common';

export const OAUTH_STATE_COOKIE = 'oauth_state';

// Lax, not Strict: the provider sends the browser back here from another site, and a Strict
// cookie would not come along. It is only readable by this server and lives ten minutes.
export const OAUTH_STATE_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
  path: '/auth',
  maxAge: 10 * 60 * 1000,
} as const;

export interface OAuthAttempt {
  provider: string;
  mode: 'signin' | 'connect';
  // The signed-in account a `connect` attempt belongs to
  userId?: string;
  returnPath?: string;
}

interface StoredAttempt extends OAuthAttempt {
  state: string;
  codeVerifier: string;
}

export interface StartedAttempt {
  state: string;
  codeChallenge: string;
  cookie: string;
}

/*
 * One sign-in attempt, kept in a signed cookie so the server stays stateless. `state` ties the
 * callback to the browser that started it (login-CSRF defence) and the PKCE verifier never leaves
 * the server side except inside this cookie. It is signed with a key derived from the JWT secret
 * so it can never be used as an access token, nor the other way round.
 */
@Injectable()
export class OAuthStateService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: AppConfigService,
  ) {}

  start(attempt: OAuthAttempt): StartedAttempt {
    const state = randomBytes(24).toString('base64url');
    const codeVerifier = randomBytes(48).toString('base64url');
    const stored: StoredAttempt = { ...attempt, state, codeVerifier };

    return {
      state,
      codeChallenge: createHash('sha256')
        .update(codeVerifier)
        .digest('base64url'),
      cookie: this.jwt.sign(stored, {
        secret: this.secret(),
        algorithm: 'HS256',
        expiresIn: '10m',
      }),
    };
  }

  // Returns the attempt only if the cookie is genuine, current, for this provider, and `state` matches
  finish(
    cookie: string | null,
    state: string | undefined,
    provider: string,
  ): StoredAttempt {
    if (!cookie || !state) {
      throw new UnauthorizedException('Sign-in attempt not found');
    }

    let stored: StoredAttempt;
    try {
      stored = this.jwt.verify<StoredAttempt>(cookie, {
        secret: this.secret(),
        algorithms: ['HS256'],
      });
    } catch {
      throw new UnauthorizedException('Sign-in attempt expired');
    }

    const expected = Buffer.from(stored.state);
    const received = Buffer.from(state);
    if (
      stored.provider !== provider ||
      expected.length !== received.length ||
      !timingSafeEqual(expected, received)
    ) {
      throw new UnauthorizedException('Sign-in attempt does not match');
    }
    return stored;
  }

  private secret(): string {
    return `${this.config.get('JWT_SECRET')}:oauth-state`;
  }
}
