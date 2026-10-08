import { Injectable } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

// import application libraries
import { AppConfigService } from '@libs/common';
import { extractAccessToken } from '@libs/common';

// import services
import { AccessTokenPayload } from '../services/token.service.js';
import { TokenService } from '../services/token.service.js';

// import models
import { User } from '../../identity/models/user.entity.js';

// import interfaces
import { RequestUser } from '../interfaces/request-user.js';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    private readonly tokenService: TokenService,
    config: AppConfigService,
  ) {
    super({
      jwtFromRequest: extractAccessToken,
      ignoreExpiration: false,
      secretOrKey: config.get('JWT_SECRET'),
      // Only what this server signs with; never whatever algorithm a token's header asks for
      algorithms: ['HS256'],
    });
  }

  /*
   * Only runs once passport-jwt has verified the token's signature and expiry.
   * Applies two state layers: reject list (explicit revocation) and
   * tokenVersion (bulk revocation).
   */
  async validate(payload: AccessTokenPayload): Promise<RequestUser> {
    const user = await this.usersRepository.findOne({
      where: { id: payload.sub },
    });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('User not found or inactive');
    }
    if (!user.isEmailVerified) {
      throw new UnauthorizedException('Email not verified');
    }
    if (user.tokenVersion !== payload.tokenVersion) {
      throw new UnauthorizedException('Token has been invalidated');
    }
    if (await this.tokenService.isRevoked(payload.jti)) {
      throw new UnauthorizedException('Token has been revoked');
    }

    // jti/exp are carried alongside the user for the logout handler
    return Object.assign(user, { jti: payload.jti, exp: payload.exp });
  }
}
