import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';

// import services
import { AuthSessionService } from './services/auth-session.service.js';

// import guards, decorators and strategies
import { JwtStrategy } from './strategies/jwt.strategy.js';

@Module({
  imports: [PassportModule],
  providers: [AuthSessionService, JwtStrategy],
})
export class IdentityModule {}
