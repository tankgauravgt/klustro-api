import { describe } from 'vitest';
import { expect } from 'vitest';
import { it } from 'vitest';
import { vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { ConflictException } from '@nestjs/common';
import { NotFoundException } from '@nestjs/common';

// import commands
import { ChangeMemberRoleCommand } from '../../../../src/member/commands/change-member-role.command.js';
import { ChangeMemberRoleHandler } from '../../../../src/member/commands/handlers/change-member-role.handler.js';
import { RemoveMemberCommand } from '../../../../src/member/commands/remove-member.command.js';
import { RemoveMemberHandler } from '../../../../src/member/commands/handlers/remove-member.handler.js';
import { TransferOwnershipCommand } from '../../../../src/member/commands/transfer-ownership.command.js';
import { TransferOwnershipHandler } from '../../../../src/member/commands/handlers/transfer-ownership.handler.js';

interface Options {
  target?: { userId: string; role: string; createdAt?: Date } | null;
  owners?: number;
  archivedAt?: Date | null;
  callerRole?: string;
}

// A fake data source whose transaction hands one fake manager to the handler
function setup(options: Options = {}) {
  const target =
    options.target === undefined
      ? { userId: 'target', role: 'member', createdAt: new Date(0) }
      : options.target;
  const membership = { userId: 'caller', role: options.callerRole ?? 'owner' };
  const members = {
    findOne: vi.fn(async () => target),
    save: vi.fn(async (value: object) => value),
    softRemove: vi.fn(async () => undefined),
    countBy: vi.fn(async (where: { role?: string }) =>
      where.role === 'owner' ? (options.owners ?? 2) : 3,
    ),
  };
  const manager = { getRepository: vi.fn(() => members) };
  const dataSource = {
    transaction: vi.fn(async (work: (m: unknown) => unknown) => work(manager)),
  };
  const project = {
    id: 'p1',
    name: 'Homelab',
    meshProvider: 'Tailscale',
    createdAt: new Date(0),
    archivedAt: options.archivedAt ?? null,
  };
  const access = {
    requireOwner: vi.fn(async () => ({ project, membership })),
    assertActive: vi.fn((p: { archivedAt: Date | null }) => {
      if (p.archivedAt) throw new ConflictException('Project is archived');
    }),
  };
  return { dataSource, access, members, target, membership, manager };
}

describe('ChangeMemberRoleHandler', () => {
  const build = (ctx: ReturnType<typeof setup>) =>
    new ChangeMemberRoleHandler(ctx.dataSource as never, ctx.access as never);
  const command = (role: 'owner' | 'member', who = 'target') =>
    new ChangeMemberRoleCommand('caller', 'p1', who, role);

  it('promotes a member and returns the new view', async () => {
    const ctx = setup();

    const view = await build(ctx).execute(command('owner'));

    expect(ctx.members.save).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'target', role: 'owner' }),
    );
    expect(view).toEqual({
      userId: 'target',
      username: null,
      displayName: null,
      role: 'owner',
      joinedAt: new Date(0),
      isYou: false,
    });
  });

  it('checks ownership outside and inside the transaction under one action', async () => {
    const ctx = setup();

    await build(ctx).execute(command('owner'));

    expect(ctx.access.requireOwner).toHaveBeenNthCalledWith(
      1,
      'caller',
      'p1',
      'project.member.update',
    );
    expect(ctx.access.requireOwner).toHaveBeenNthCalledWith(
      2,
      'caller',
      'p1',
      'project.member.update',
      ctx.manager,
    );
  });

  it('demotes an owner while another owner remains', async () => {
    const ctx = setup({
      target: { userId: 'target', role: 'owner' },
      owners: 2,
    });

    const view = await build(ctx).execute(command('member'));

    expect(view.role).toBe('member');
    expect(ctx.members.save).toHaveBeenCalledTimes(1);
  });

  it('refuses to demote the last owner with 409', async () => {
    const ctx = setup({
      target: { userId: 'target', role: 'owner' },
      owners: 1,
    });

    await expect(build(ctx).execute(command('member'))).rejects.toThrow(
      ConflictException,
    );

    expect(ctx.members.save).not.toHaveBeenCalled();
  });

  it.each([
    ['member', 'member'],
    ['owner', 'owner'],
  ] as const)(
    'does nothing when a %s is given the role %s again',
    async (current, role) => {
      const ctx = setup({
        target: { userId: 'target', role: current },
        owners: 1,
      });

      const view = await build(ctx).execute(command(role));

      expect(view.role).toBe(role);
      expect(ctx.members.save).not.toHaveBeenCalled();
      expect(ctx.members.countBy).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['owner', 'member'],
    ['owner', 'owner'],
    ['member', 'owner'],
  ] as const)(
    'refuses with 400 when a %s sets their own role to %s',
    async (current, role) => {
      const ctx = setup({ target: { userId: 'caller', role: current } });

      await expect(build(ctx).execute(command(role, 'caller'))).rejects.toThrow(
        BadRequestException,
      );

      expect(ctx.dataSource.transaction).not.toHaveBeenCalled();
      expect(ctx.members.save).not.toHaveBeenCalled();
    },
  );

  it('checks that the caller is an owner before it refuses a self change', async () => {
    const ctx = setup();
    ctx.access.requireOwner.mockRejectedValueOnce(
      new NotFoundException('Project not found'),
    );

    await expect(
      build(ctx).execute(command('owner', 'caller')),
    ).rejects.toThrow(NotFoundException);
  });

  it('answers 404 for someone who is not a member', async () => {
    const ctx = setup({ target: null });
    await expect(build(ctx).execute(command('owner'))).rejects.toThrow(
      NotFoundException,
    );
  });

  it('answers 409 for an archived project before looking at members', async () => {
    const ctx = setup({ archivedAt: new Date() });

    await expect(build(ctx).execute(command('owner'))).rejects.toThrow(
      'Project is archived',
    );

    expect(ctx.members.findOne).not.toHaveBeenCalled();
  });

  it('never starts the transaction when the caller is not an owner', async () => {
    const ctx = setup();
    ctx.access.requireOwner.mockRejectedValueOnce(new Error('denied'));

    await expect(build(ctx).execute(command('owner'))).rejects.toThrow(
      'denied',
    );

    expect(ctx.dataSource.transaction).not.toHaveBeenCalled();
  });
});

describe('RemoveMemberHandler', () => {
  const build = (ctx: ReturnType<typeof setup>) =>
    new RemoveMemberHandler(ctx.dataSource as never, ctx.access as never);

  it('soft-removes the member', async () => {
    const ctx = setup();

    await build(ctx).execute(new RemoveMemberCommand('caller', 'p1', 'target'));

    expect(ctx.members.softRemove).toHaveBeenCalledWith(ctx.target);
    expect(ctx.members.findOne).toHaveBeenCalledWith({
      where: { projectId: 'p1', userId: 'target' },
    });
  });

  it('refuses to remove the caller with 400, after the ownership check', async () => {
    const ctx = setup();

    await expect(
      build(ctx).execute(new RemoveMemberCommand('caller', 'p1', 'caller')),
    ).rejects.toThrow(BadRequestException);

    expect(ctx.access.requireOwner).toHaveBeenCalledTimes(1);
    expect(ctx.dataSource.transaction).not.toHaveBeenCalled();
  });

  it('shows a non-owner the denial rather than the self-removal error', async () => {
    const ctx = setup();
    ctx.access.requireOwner.mockRejectedValueOnce(new Error('denied'));

    await expect(
      build(ctx).execute(new RemoveMemberCommand('caller', 'p1', 'caller')),
    ).rejects.toThrow('denied');
  });

  it('answers 404 for an unknown member', async () => {
    const ctx = setup({ target: null });
    await expect(
      build(ctx).execute(new RemoveMemberCommand('caller', 'p1', 'ghost')),
    ).rejects.toThrow(NotFoundException);
    expect(ctx.members.softRemove).not.toHaveBeenCalled();
  });

  it('answers 409 for an archived project', async () => {
    const ctx = setup({ archivedAt: new Date() });
    await expect(
      build(ctx).execute(new RemoveMemberCommand('caller', 'p1', 'target')),
    ).rejects.toThrow(ConflictException);
    expect(ctx.members.softRemove).not.toHaveBeenCalled();
  });
});

describe('TransferOwnershipHandler', () => {
  const build = (ctx: ReturnType<typeof setup>) =>
    new TransferOwnershipHandler(ctx.dataSource as never, ctx.access as never);
  const command = (who = 'target') =>
    new TransferOwnershipCommand('caller', 'p1', who);

  it('makes the target an owner and the caller a member', async () => {
    const ctx = setup();

    const summary = await build(ctx).execute(command());

    expect(ctx.target).toMatchObject({ role: 'owner' });
    expect(ctx.membership.role).toBe('member');
    expect(ctx.members.save).toHaveBeenCalledTimes(2);
    expect(ctx.members.save).toHaveBeenNthCalledWith(1, ctx.target);
    expect(ctx.members.save).toHaveBeenNthCalledWith(2, ctx.membership);
    expect(summary).toMatchObject({
      id: 'p1',
      role: 'member',
      memberCount: 3,
      archivedAt: null,
    });
  });

  it('refuses a hand-over to yourself with 400', async () => {
    const ctx = setup();
    await expect(build(ctx).execute(command('caller'))).rejects.toThrow(
      BadRequestException,
    );
    expect(ctx.dataSource.transaction).not.toHaveBeenCalled();
  });

  it('answers 404 when the target is not a member, changing nothing', async () => {
    const ctx = setup({ target: null });
    await expect(build(ctx).execute(command())).rejects.toThrow(
      NotFoundException,
    );
    expect(ctx.members.save).not.toHaveBeenCalled();
    expect(ctx.membership.role).toBe('owner');
  });

  it('answers 409 when the target already owns the project, changing nothing', async () => {
    const ctx = setup({ target: { userId: 'target', role: 'owner' } });
    await expect(build(ctx).execute(command())).rejects.toThrow(
      ConflictException,
    );
    expect(ctx.members.save).not.toHaveBeenCalled();
    expect(ctx.membership.role).toBe('owner');
  });

  it('answers 409 for an archived project, changing nothing', async () => {
    const ctx = setup({ archivedAt: new Date() });
    await expect(build(ctx).execute(command())).rejects.toThrow(
      'Project is archived',
    );
    expect(ctx.members.save).not.toHaveBeenCalled();
    expect(ctx.membership.role).toBe('owner');
  });
});
