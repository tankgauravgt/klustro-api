import { afterEach } from 'vitest';
import { beforeEach } from 'vitest';
import { describe } from 'vitest';
import { expect } from 'vitest';
import { it } from 'vitest';
import { vi } from 'vitest';

// import application libraries
import { resolveAddress } from '@libs/common';

vi.mock('@libs/common', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@libs/common')>()),
  resolveAddress: vi.fn(),
}));

// import services
import { UserDirectoryService } from '../../../src/identity/services/user-directory.service.js';

describe('UserDirectoryService', () => {
  const service = new UserDirectoryService();
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    vi.mocked(resolveAddress).mockReturnValue('http://auth.test');
  });

  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
  });

  it("asks the auth service with the caller's own token and maps the answer by id", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => [{ id: 'u1', username: 'ada', displayName: 'Ada L' }],
    });

    const cards = await service.lookup('Bearer abc', ['u1', 'u1', 'u2']);

    expect(cards.get('u1')?.displayName).toBe('Ada L');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://auth.test/auth/users/lookup');
    expect(init.headers.Authorization).toBe('Bearer abc');
    expect(JSON.parse(init.body)).toEqual({ ids: ['u1', 'u2'] });
  });

  it.each([['without a token', undefined]])(
    'answers nothing %s',
    async (_name, authorization) => {
      expect((await service.lookup(authorization, ['u1'])).size).toBe(0);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('does not call out for an empty list', async () => {
    expect((await service.lookup('Bearer abc', [])).size).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('answers nothing when the auth service is not running', async () => {
    vi.mocked(resolveAddress).mockReturnValue(undefined);

    expect((await service.lookup('Bearer abc', ['u1'])).size).toBe(0);
  });

  it('answers nothing when the auth service refuses or fails', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => [] });
    expect((await service.lookup('Bearer abc', ['u1'])).size).toBe(0);

    fetchMock.mockRejectedValueOnce(new Error('down'));
    expect((await service.lookup('Bearer abc', ['u1'])).size).toBe(0);
  });
});
