import { Module } from '@nestjs/common';

// import application libraries
import { AppConfigModule } from '@libs/common';
import { DatabaseModule } from '@libs/common';
import { GovernanceModule } from '@libs/governance';

// import modules
import { AuditModule } from './audit/audit.module.js';
import { IdentityModule } from './identity/identity.module.js';
import { InviteModule } from './invite/invite.module.js';
import { MemberModule } from './member/member.module.js';
import { ProjectModule } from './project/project.module.js';

@Module({
  imports: [
    AppConfigModule,
    DatabaseModule.forRoot('projects'),
    GovernanceModule.forRoot('projects'),
    IdentityModule,
    ProjectModule,
    InviteModule,
    MemberModule,
    AuditModule,
  ],
})
export class ProjectsModule {}
