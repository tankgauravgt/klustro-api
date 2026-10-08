import { Injectable } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-jwt';

// import application libraries
import { AppConfigService } from '@libs/common';
import { extractAccessToken } from '@libs/common';

// import services
import { AuthSessionService } from '../services/auth-session.service.js';

// import interfaces
import type { AuthenticatedUser } from '../interfaces/authenticated-user.js';

/*
 * The signature and expiry are checked here with the secret shared with the auth service, which
 * cheaply turns away forged and expired tokens. Everything that can change afterwards (logout,
 * password reset, deactivation) lives in the auth service, so it is asked on every request.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: AppConfigService,
    private readonly authSession: AuthSessionService,
  ) {
    super({
      jwtFromRequest: extractAccessToken,
      ignoreExpiration: false,
      secretOrKey: config.get('JWT_SECRET'),
      algorithms: ['HS256'],
      passReqToCallback: true,
    });
  }

  async validate(request: {
    headers: { authorization?: string; cookie?: string };
  }): Promise<AuthenticatedUser> {
    const token = extractAccessToken(request);
    if (!token) {
      throw new UnauthorizedException();
    }
    return this.authSession.verify(token);
  }
}
