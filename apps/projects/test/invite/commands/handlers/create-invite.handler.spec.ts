import { describe } from 'vitest';
import { expect } from 'vitest';
import { it } from 'vitest';
import { vi } from 'vitest';
import { ConflictException } from '@nestjs/common';

// import commands
import { CreateInviteCommand } from '../../../../src/invite/commands/create-invite.command.js';
import { CreateInviteHandler } from '../../../../src/invite/commands/handlers/create-invite.handler.js';

const handlerFor = (frontendUrl: string, archivedAt: Date | null = null) => {
  const invites = {
    create: vi.fn((value: object) => value),
    save: vi.fn(async (value: object) => ({ id: 'invite-1', ...value })),
  };
  const access = {
    requireOwner: vi.fn(async () => ({ project: { archivedAt } })),
    assertActive: vi.fn((project: { archivedAt: Date | null }) => {
      if (project.archivedAt)
        throw new ConflictException('Project is archived');
    }),
  };
  const config = { get: () => frontendUrl };
  const handler = new CreateInviteHandler(
    invites as never,
    access as never,
    config as never,
  );
  return { handler, invites, access };
};

describe('CreateInviteHandler invite link', () => {
  const command = new CreateInviteCommand('user-1', 'project-1', 60, 'member');

  it.each([
    'https://app.example.com',
    'https://app.example.com/',
    'https://app.example.com///',
  ])('has one slash before /invite when WEB_URL is %s', async (url) => {
    const { inviteLink } = await handlerFor(url).handler.execute(command);

    expect(inviteLink).toMatch(
      /^https:\/\/app\.example\.com\/invite\/[0-9a-f]{64}$/,
    );
  });

  it('keeps a path in WEB_URL', async () => {
    const { inviteLink } = await handlerFor(
      'https://example.com/app/',
    ).handler.execute(command);

    expect(inviteLink).toMatch(/^https:\/\/example\.com\/app\/invite\//);
  });
});

describe('CreateInviteHandler authorisation', () => {
  const command = new CreateInviteCommand('user-1', 'project-1', 60, 'member');

  it('asks for an owner of the project under the invite-create action', async () => {
    const { handler, access } = handlerFor('https://a.test');

    await handler.execute(command);

    expect(access.requireOwner).toHaveBeenCalledWith(
      'user-1',
      'project-1',
      'project.invite.create',
    );
  });

  it('stores nothing when the caller is not an owner', async () => {
    const { handler, access, invites } = handlerFor('https://a.test');
    access.requireOwner.mockRejectedValueOnce(new Error('denied'));

    await expect(handler.execute(command)).rejects.toThrow('denied');

    expect(invites.save).not.toHaveBeenCalled();
  });

  it('rejects an archived project with 409 and stores nothing', async () => {
    const { handler, invites } = handlerFor('https://a.test', new Date());

    await expect(handler.execute(command)).rejects.toThrow(ConflictException);

    expect(invites.save).not.toHaveBeenCalled();
  });
});

describe('CreateInviteHandler stored invite', () => {
  it.each(['member', 'owner'] as const)(
    'passes the %s role through to the invite and the result',
    async (role) => {
      const { handler, invites } = handlerFor('https://a.test');

      const result = await handler.execute(
        new CreateInviteCommand('user-1', 'project-1', 60, role),
      );

      expect(invites.create).toHaveBeenCalledWith(
        expect.objectContaining({
          role,
          projectId: 'project-1',
          createdByUserId: 'user-1',
        }),
      );
      expect(result).toMatchObject({ id: 'invite-1', role });
    },
  );

  it('stores only the hash of the token that is in the link', async () => {
    const { handler, invites } = handlerFor('https://a.test');

    const { inviteLink } = await handler.execute(
      new CreateInviteCommand('user-1', 'project-1', 60, 'member'),
    );

    const token = inviteLink.split('/').pop() as string;
    const created = invites.create.mock.calls[0][0] as { tokenHash: string };
    expect(created.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(created.tokenHash).not.toBe(token);
    expect(JSON.stringify(created)).not.toContain(token);
  });

  it('expires the invite after the requested minutes', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));
    try {
      const { handler } = handlerFor('https://a.test');

      const { expiresAt } = await handler.execute(
        new CreateInviteCommand('user-1', 'project-1', 90, 'member'),
      );

      expect(expiresAt.toISOString()).toBe('2025-01-01T01:30:00.000Z');
    } finally {
      vi.useRealTimers();
    }
  });
});
