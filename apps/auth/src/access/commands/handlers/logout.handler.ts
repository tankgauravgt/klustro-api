import { CommandHandler } from '@nestjs/cqrs';
import { ICommandHandler } from '@nestjs/cqrs';

// import application libraries
import { AuditService } from '@libs/governance';
import { RequestContextService } from '@libs/governance';

// import features
import { TokenService } from '../../services/token.service.js';

// import commands
import { LogoutCommand } from '../logout.command.js';

@CommandHandler(LogoutCommand)
export class LogoutHandler implements ICommandHandler<LogoutCommand, void> {
  constructor(
    private readonly tokenService: TokenService,
    private readonly audit: AuditService,
    private readonly context: RequestContextService,
  ) {}

  async execute(command: LogoutCommand): Promise<void> {
    await this.tokenService.revoke(command.jti, command.expiresAt);

    const userId = this.context.actorId();
    await this.audit.record({
      action: 'auth.logout',
      entityType: 'user',
      entityId: userId,
      scope: userId ? `user:${userId}` : null,
    });
  }
}
