import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';

// import services
import { AuthSessionService } from './services/auth-session.service.js';
import { UserDirectoryService } from './services/user-directory.service.js';

// import guards, decorators and strategies
import { JwtStrategy } from './strategies/jwt.strategy.js';

@Module({
  imports: [PassportModule],
  providers: [AuthSessionService, JwtStrategy, UserDirectoryService],
  exports: [UserDirectoryService],
})
export class IdentityModule {}
