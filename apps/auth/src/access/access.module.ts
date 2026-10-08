import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';

// import application libraries
import { AppConfigService } from '@libs/common';

// import modules
import { TrustModule } from '../trust/trust.module.js';
import { OAuthModule } from './oauth/oauth.module.js';

// import controllers
import { AuthenticationController } from './authentication.controller.js';
import { SessionController } from './session.controller.js';

// import services
import { TokenService } from './services/token.service.js';

// import handlers
import { IssueAccessTokenHandler } from './commands/handlers/issue-access-token.handler.js';
import { LogoutHandler } from './commands/handlers/logout.handler.js';
import { OAuthSignInHandler } from './commands/handlers/oauth-sign-in.handler.js';
import { SignInHandler } from './commands/handlers/sign-in.handler.js';

// import models
import { Email } from '../identity/models/email.entity.js';
import { OAuthAccount } from '../identity/models/oauth-account.entity.js';
import { User } from '../identity/models/user.entity.js';
import { RevokedToken } from './models/revoked-token.entity.js';

// import guards, decorators and strategies
import { JwtStrategy } from './strategies/jwt.strategy.js';

const commandHandlers = [
  SignInHandler,
  LogoutHandler,
  OAuthSignInHandler,
  IssueAccessTokenHandler,
];

// How someone gets in and stays in: password and OAuth sign-in, sign-out, access tokens, guards
@Module({
  imports: [
    CqrsModule,
    PassportModule,
    TrustModule,
    OAuthModule,
    JwtModule.registerAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        secret: config.get('JWT_SECRET'),
        signOptions: {
          algorithm: 'HS256',
          expiresIn: config.get(
            'JWT_EXPIRES_IN',
          ) as `${number}${'s' | 'm' | 'h' | 'd'}`,
        },
      }),
    }),
    TypeOrmModule.forFeature([User, Email, OAuthAccount, RevokedToken]),
  ],
  controllers: [AuthenticationController, SessionController],
  providers: [TokenService, JwtStrategy, ...commandHandlers],
})
export class AccessModule {}
