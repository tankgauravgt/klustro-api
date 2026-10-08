import { describe } from 'vitest';
import { expect } from 'vitest';
import { it } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';

// import services
import { TokenService } from '../../../../src/access/services/token.service.js';

// import commands
import { IssueAccessTokenCommand } from '../../../../src/access/commands/issue-access-token.command.js';
import { IssueAccessTokenHandler } from '../../../../src/access/commands/handlers/issue-access-token.handler.js';

describe('IssueAccessTokenHandler', () => {
  const tokens = new TokenService(
    { sign: () => 'signed-token' } as never,
    {} as never,
  );
  const handler = new IssueAccessTokenHandler(tokens);

  it('hands back the token of an active account', async () => {
    const command = new IssueAccessTokenCommand({
      id: 'user-1',
      tokenVersion: 0,
      isActive: true,
    } as never);

    await expect(handler.execute(command)).resolves.toBe('signed-token');
  });

  it('rejects, rather than throws, for a deactivated account', async () => {
    const command = new IssueAccessTokenCommand({
      id: 'user-1',
      tokenVersion: 0,
      isActive: false,
    } as never);

    await expect(handler.execute(command)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
