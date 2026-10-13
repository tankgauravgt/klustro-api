import { describe } from 'vitest';
import { expect } from 'vitest';
import { it } from 'vitest';
import { vi } from 'vitest';

// import queries
import { LookupUsersQuery } from '../../../../src/identity/queries/lookup-users.query.js';
import { LookupUsersHandler } from '../../../../src/identity/queries/handlers/lookup-users.handler.js';

const handlerFor = (users: object[]) => {
  const repository = { find: vi.fn(async () => users) };
  return { handler: new LookupUsersHandler(repository as never), repository };
};

describe('LookupUsersHandler', () => {
  it('names a person by first and last name', async () => {
    const { handler } = handlerFor([
      { id: 'u1', username: 'ada', firstName: 'Ada', lastName: 'Lovelace' },
    ]);

    expect(await handler.execute(new LookupUsersQuery(['u1']))).toEqual([
      { id: 'u1', username: 'ada', displayName: 'Ada Lovelace' },
    ]);
  });

  it.each([
    [null, null],
    ['', '  '],
  ])('falls back to the username when the name is %s / %s', async (f, l) => {
    const { handler } = handlerFor([
      { id: 'u1', username: 'ada', firstName: f, lastName: l },
    ]);

    const [card] = await handler.execute(new LookupUsersQuery(['u1']));

    expect(card.displayName).toBe('ada');
  });

  it('uses a single name when only one is set', async () => {
    const { handler } = handlerFor([
      { id: 'u1', username: 'ada', firstName: 'Ada', lastName: null },
    ]);

    const [card] = await handler.execute(new LookupUsersQuery(['u1']));

    expect(card.displayName).toBe('Ada');
  });

  it('shares nothing but id, username and display name', async () => {
    const { handler } = handlerFor([
      {
        id: 'u1',
        username: 'ada',
        firstName: 'Ada',
        lastName: 'L',
        email: 'ada@example.com',
        passwordHash: 'secret',
      },
    ]);

    const [card] = await handler.execute(new LookupUsersQuery(['u1']));

    expect(Object.keys(card).sort()).toEqual(['displayName', 'id', 'username']);
  });

  it('only asks for active accounts', async () => {
    const { handler, repository } = handlerFor([]);

    await handler.execute(new LookupUsersQuery(['u1']));

    expect(repository.find).toHaveBeenCalledWith({
      where: expect.objectContaining({ isActive: true }),
    });
  });
});
