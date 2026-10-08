import { describe } from 'vitest';
import { expect } from 'vitest';
import { it } from 'vitest';
import { vi } from 'vitest';

// import queries
import { GetConnectionsQuery } from '../../../../src/identity/queries/get-connections.query.js';
import { GetConnectionsHandler } from '../../../../src/identity/queries/handlers/get-connections.handler.js';

describe('GetConnectionsHandler', () => {
  it('hands back only the id, the provider and when it was connected', async () => {
    const connectedAt = new Date('2026-01-02T03:04:05Z');
    const find = vi.fn(async () => [
      {
        id: 'link-1',
        provider: 'github',
        providerAccountId: 'the-providers-own-id',
        userId: 'user-1',
        createdAt: connectedAt,
        updatedAt: connectedAt,
        deletedAt: null,
        createdBy: 'user-1',
        updatedBy: null,
        deletedBy: null,
      },
    ]);
    const handler = new GetConnectionsHandler({ find } as never);

    const result = await handler.execute(new GetConnectionsQuery('user-1'));

    expect(result).toEqual([{ id: 'link-1', provider: 'github', connectedAt }]);
    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1' } }),
    );
  });
});
