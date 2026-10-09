import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { TypeOrmModule } from '@nestjs/typeorm';

// import application libraries
import { MailModule } from '@libs/mail';

// import controllers
import { EmailVerificationController } from './email-verification.controller.js';
import { PasswordRecoveryController } from './password-recovery.controller.js';
import { SignUpController } from './sign-up.controller.js';

// import services
import { EmailClaimService } from './services/email-claim.service.js';
import { EmailVerificationService } from './services/email-verification.service.js';
import { PasswordResetEmailService } from './services/password-reset-email.service.js';
import { PasswordService } from './services/password.service.js';

// import handlers
import { ForgotPasswordHandler } from './commands/handlers/forgot-password.handler.js';
import { ResendEmailVerificationHandler } from './commands/handlers/resend-email-verification.handler.js';
import { ResetPasswordHandler } from './commands/handlers/reset-password.handler.js';
import { SignUpHandler } from './commands/handlers/sign-up.handler.js';
import { VerifyEmailHandler } from './commands/handlers/verify-email.handler.js';

// import models
import { Email } from '../identity/models/email.entity.js';
import { OAuthAccount } from '../identity/models/oauth-account.entity.js';
import { User } from '../identity/models/user.entity.js';
import { EmailVerificationToken } from './models/email-verification-token.entity.js';
import { PasswordResetToken } from './models/password-reset-token.entity.js';

const commandHandlers = [
  SignUpHandler,
  ForgotPasswordHandler,
  ResetPasswordHandler,
  ResendEmailVerificationHandler,
  VerifyEmailHandler,
];

// What can be believed: sign-up and who may hold an email address, password hashing and recovery
@Module({
  imports: [
    CqrsModule,
    MailModule,
    TypeOrmModule.forFeature([
      User,
      Email,
      OAuthAccount,
      PasswordResetToken,
      EmailVerificationToken,
    ]),
  ],
  controllers: [
    SignUpController,
    PasswordRecoveryController,
    EmailVerificationController,
  ],
  providers: [
    PasswordService,
    EmailClaimService,
    EmailVerificationService,
    PasswordResetEmailService,
    ...commandHandlers,
  ],
  exports: [PasswordService, EmailClaimService, EmailVerificationService],
})
export class TrustModule {}
