import { CommandHandler } from '@nestjs/cqrs';
import { ICommandHandler } from '@nestjs/cqrs';

// import services
import { TokenService } from '../../services/token.service.js';

// import commands
import { IssueAccessTokenCommand } from '../issue-access-token.command.js';

@CommandHandler(IssueAccessTokenCommand)
export class IssueAccessTokenHandler implements ICommandHandler<
  IssueAccessTokenCommand,
  string
> {
  constructor(private readonly tokenService: TokenService) {}

  async execute(command: IssueAccessTokenCommand): Promise<string> {
    return this.tokenService.issue(command.user);
  }
}
