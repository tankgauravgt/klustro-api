import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';

// import modules
import { ProjectModule } from '../project/project.module.js';

// import controllers
import { InviteController } from './invite.controller.js';

// import handlers
import { AcceptInviteHandler } from './commands/handlers/accept-invite.handler.js';
import { CreateInviteHandler } from './commands/handlers/create-invite.handler.js';
import { ListInvitesHandler } from './queries/handlers/list-invites.handler.js';
import { PreviewInviteHandler } from './queries/handlers/preview-invite.handler.js';
import { RevokeInviteHandler } from './commands/handlers/revoke-invite.handler.js';

@Module({
  imports: [CqrsModule, ProjectModule],
  controllers: [InviteController],
  providers: [
    CreateInviteHandler,
    AcceptInviteHandler,
    ListInvitesHandler,
    PreviewInviteHandler,
    RevokeInviteHandler,
  ],
})
export class InviteModule {}
