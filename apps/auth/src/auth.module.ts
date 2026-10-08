import { Module } from '@nestjs/common';

// import application libraries
import { AppConfigModule } from '@libs/common';
import { DatabaseModule } from '@libs/common';
import { RateLimitModule } from '@libs/common';
import { GovernanceModule } from '@libs/governance';

// import modules
import { AccessModule } from './access/access.module.js';
import { AuthGovernanceModule } from './governance/governance.module.js';
import { IdentityModule } from './identity/identity.module.js';
import { TrustModule } from './trust/trust.module.js';

@Module({
  imports: [
    AppConfigModule,
    DatabaseModule.forRoot('auth'),
    RateLimitModule,
    GovernanceModule.forRoot('auth'),
    IdentityModule,
    AccessModule,
    TrustModule,
    AuthGovernanceModule,
  ],
})
export class AuthModule {}
