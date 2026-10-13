import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';

// import modules
import { IdentityModule } from '../identity/identity.module.js';
import { ProjectModule } from '../project/project.module.js';

// import controllers
import { MemberController } from './member.controller.js';

// import handlers
import { ChangeMemberRoleHandler } from './commands/handlers/change-member-role.handler.js';
import { ListMembersHandler } from './queries/handlers/list-members.handler.js';
import { RemoveMemberHandler } from './commands/handlers/remove-member.handler.js';
import { TransferOwnershipHandler } from './commands/handlers/transfer-ownership.handler.js';

@Module({
  imports: [CqrsModule, IdentityModule, ProjectModule],
  controllers: [MemberController],
  providers: [
    ChangeMemberRoleHandler,
    ListMembersHandler,
    RemoveMemberHandler,
    TransferOwnershipHandler,
  ],
})
export class MemberModule {}
