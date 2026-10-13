import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { TypeOrmModule } from '@nestjs/typeorm';

// import modules
import { TrustModule } from '../trust/trust.module.js';

// import controllers
import { ConnectionsController } from './connections.controller.js';
import { EmailsController } from './emails.controller.js';
import { PasswordController } from './password.controller.js';
import { ProfileController } from './profile.controller.js';

// import handlers
import { AddEmailHandler } from './commands/handlers/add-email.handler.js';
import { ChangeUsernameHandler } from './commands/handlers/change-username.handler.js';
import { ConnectOAuthHandler } from './commands/handlers/connect-oauth.handler.js';
import { DisconnectOAuthHandler } from './commands/handlers/disconnect-oauth.handler.js';
import { RemoveEmailHandler } from './commands/handlers/remove-email.handler.js';
import { SetPasswordHandler } from './commands/handlers/set-password.handler.js';
import { SetPrimaryEmailHandler } from './commands/handlers/set-primary-email.handler.js';
import { GetConnectionsHandler } from './queries/handlers/get-connections.handler.js';
import { GetProfileHandler } from './queries/handlers/get-profile.handler.js';
import { GetEmailsHandler } from './queries/handlers/get-emails.handler.js';
import { LookupUsersHandler } from './queries/handlers/lookup-users.handler.js';

// import models
import { Email } from './models/email.entity.js';
import { OAuthAccount } from './models/oauth-account.entity.js';
import { User } from './models/user.entity.js';

const commandHandlers = [
  ChangeUsernameHandler,
  ConnectOAuthHandler,
  DisconnectOAuthHandler,
  AddEmailHandler,
  SetPrimaryEmailHandler,
  RemoveEmailHandler,
  SetPasswordHandler,
];

const queryHandlers = [
  GetConnectionsHandler,
  GetEmailsHandler,
  GetProfileHandler,
  LookupUsersHandler,
];

// Who the account is: profile and username, emails, linked providers, password setting
@Module({
  imports: [
    CqrsModule,
    TrustModule,
    TypeOrmModule.forFeature([User, Email, OAuthAccount]),
  ],
  controllers: [
    ProfileController,
    ConnectionsController,
    EmailsController,
    PasswordController,
  ],
  providers: [...commandHandlers, ...queryHandlers],
})
export class IdentityModule {}
