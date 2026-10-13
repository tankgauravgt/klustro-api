import { describe } from 'vitest';
import { expect } from 'vitest';
import { it } from 'vitest';
import { vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';

// import commands
import { RevokeInviteCommand } from '../../../../src/invite/commands/revoke-invite.command.js';
import { RevokeInviteHandler } from '../../../../src/invite/commands/handlers/revoke-invite.handler.js';

const setup = (found: object | null) => {
  const invites = {
    findOne: vi.fn(async () => found),
    softRemove: vi.fn(async () => undefined),
  };
  const access = { requireOwner: vi.fn(async () => ({})) };
  return {
    handler: new RevokeInviteHandler(invites as never, access as never),
    invites,
    access,
  };
};

describe('RevokeInviteHandler', () => {
  const command = new RevokeInviteCommand('u1', 'p1', 'i1');

  it('checks ownership, then soft-removes the invite of that project', async () => {
    const invite = { id: 'i1' };
    const { handler, invites, access } = setup(invite);

    await handler.execute(command);

    expect(access.requireOwner).toHaveBeenCalledWith(
      'u1',
      'p1',
      'project.invite.revoke',
    );
    expect(invites.findOne).toHaveBeenCalledWith({
      where: { id: 'i1', projectId: 'p1' },
    });
    expect(invites.softRemove).toHaveBeenCalledWith(invite);
  });

  it('answers 404 when the project has no such invite', async () => {
    const { handler, invites } = setup(null);

    await expect(handler.execute(command)).rejects.toThrow(NotFoundException);

    expect(invites.softRemove).not.toHaveBeenCalled();
  });

  it('does not even look for the invite when the caller is not an owner', async () => {
    const { handler, invites, access } = setup({ id: 'i1' });
    access.requireOwner.mockRejectedValueOnce(new Error('denied'));

    await expect(handler.execute(command)).rejects.toThrow('denied');

    expect(invites.findOne).not.toHaveBeenCalled();
  });
});
