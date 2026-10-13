import { describe } from 'vitest';
import { expect } from 'vitest';
import { it } from 'vitest';
import { vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';

// import queries
import { ListMembersHandler } from '../../../../src/member/queries/handlers/list-members.handler.js';
import { ListMembersQuery } from '../../../../src/member/queries/list-members.query.js';

const T0 = new Date('2024-01-01T00:00:00Z');
const T1 = new Date('2024-01-02T00:00:00Z');

function setup(
  options: {
    cards?: { id: string; username: string; displayName: string }[];
    denied?: boolean;
  } = {},
) {
  const rows = [
    { userId: 'owner', role: 'owner', createdAt: T0 },
    { userId: 'ghost', role: 'member', createdAt: T1 },
    { userId: 'caller', role: 'member', createdAt: T1 },
  ];
  const repository = { find: vi.fn(async () => rows) };
  const access = {
    requireMember: vi.fn(async () => {
      if (options.denied) {
        throw new NotFoundException('Project not found');
      }
    }),
  };
  const directory = {
    lookup: vi.fn(
      async () => new Map((options.cards ?? []).map((c) => [c.id, c])),
    ),
  };
  const handler = new ListMembersHandler(
    repository as never,
    access as never,
    directory as never,
  );
  return { handler, repository, access, directory };
}

describe('ListMembersHandler', () => {
  it('merges names by user id and keeps order, role, joinedAt and isYou', async () => {
    const { handler } = setup({
      cards: [
        { id: 'owner', username: 'olga', displayName: 'Olga O' },
        { id: 'caller', username: 'cal', displayName: 'Cal C' },
      ],
    });

    const result = await handler.execute(
      new ListMembersQuery('caller', 'p1', 'Bearer abc'),
    );

    expect(result).toEqual([
      {
        userId: 'owner',
        username: 'olga',
        displayName: 'Olga O',
        role: 'owner',
        joinedAt: T0,
        isYou: false,
      },
      {
        userId: 'ghost',
        username: null,
        displayName: null,
        role: 'member',
        joinedAt: T1,
        isYou: false,
      },
      {
        userId: 'caller',
        username: 'cal',
        displayName: 'Cal C',
        role: 'member',
        joinedAt: T1,
        isYou: true,
      },
    ]);
  });

  it('asks the directory with the caller authorization and every member id', async () => {
    const { handler, directory, repository } = setup();

    await handler.execute(new ListMembersQuery('caller', 'p1', 'Bearer abc'));

    expect(directory.lookup).toHaveBeenCalledTimes(1);
    expect(directory.lookup).toHaveBeenCalledWith('Bearer abc', [
      'owner',
      'ghost',
      'caller',
    ]);
    expect(repository.find).toHaveBeenCalledWith({
      where: { projectId: 'p1' },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
  });

  it('still lists everyone, with null names, when the directory is empty', async () => {
    const { handler } = setup();

    const result = await handler.execute(new ListMembersQuery('caller', 'p1'));

    expect(result.map((m) => m.userId)).toEqual(['owner', 'ghost', 'caller']);
    expect(result.every((m) => m.username === null)).toBe(true);
    expect(result.every((m) => m.displayName === null)).toBe(true);
  });

  it('passes an undefined authorization through to the directory', async () => {
    const { handler, directory } = setup();

    await handler.execute(new ListMembersQuery('caller', 'p1'));

    expect(directory.lookup).toHaveBeenCalledWith(undefined, expect.any(Array));
  });

  it('propagates the not-found error before reading members or looking anyone up', async () => {
    const { handler, repository, directory, access } = setup({ denied: true });

    await expect(
      handler.execute(new ListMembersQuery('outsider', 'p1', 'Bearer abc')),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(access.requireMember).toHaveBeenCalledWith('outsider', 'p1');
    expect(repository.find).not.toHaveBeenCalled();
    expect(directory.lookup).not.toHaveBeenCalled();
  });
});
