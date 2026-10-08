import { describe } from 'vitest';
import { expect } from 'vitest';
import { it } from 'vitest';
import { vi } from 'vitest';

// import commands
import { CreateInviteCommand } from '../../../../src/invite/commands/create-invite.command.js';
import { CreateInviteHandler } from '../../../../src/invite/commands/handlers/create-invite.handler.js';

const handlerFor = (frontendUrl: string) => {
  const members = { findOne: vi.fn(async () => ({ role: 'owner' })) };
  const invites = {
    create: vi.fn((value: object) => value),
    save: vi.fn(async (value: object) => value),
  };
  const config = { get: () => frontendUrl };
  return new CreateInviteHandler(
    members as never,
    invites as never,
    { record: vi.fn() } as never,
    config as never,
  );
};

describe('CreateInviteHandler invite link', () => {
  const command = new CreateInviteCommand('user-1', 'project-1', 60);

  it.each([
    'https://app.example.com',
    'https://app.example.com/',
    'https://app.example.com///',
  ])('has one slash before /invite when WEB_URL is %s', async (url) => {
    const { inviteLink } = await handlerFor(url).execute(command);

    expect(inviteLink).toMatch(
      /^https:\/\/app\.example\.com\/invite\/[0-9a-f]{64}$/,
    );
  });

  it('keeps a path in WEB_URL', async () => {
    const { inviteLink } = await handlerFor('https://example.com/app/').execute(
      command,
    );

    expect(inviteLink).toMatch(/^https:\/\/example\.com\/app\/invite\//);
  });
});
