import { afterEach } from 'vitest';
import { beforeEach } from 'vitest';
import { describe } from 'vitest';
import { expect } from 'vitest';
import { it } from 'vitest';
import { vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';

// import services
import { TokenService } from '../../../src/access/services/token.service.js';

describe('TokenService reject-list pruning', () => {
  const expired = { jti: 'old' };
  const revokedTokens = {
    find: vi.fn(async () => [expired]),
    softRemove: vi.fn(async () => undefined),
  };
  let service: TokenService;

  beforeEach(() => {
    vi.useFakeTimers();
    revokedTokens.find.mockClear();
    revokedTokens.softRemove.mockClear();
    service = new TokenService({} as never, revokedTokens as never);
  });

  afterEach(() => {
    service.onModuleDestroy();
    vi.useRealTimers();
  });

  it('retires entries whose token has expired', async () => {
    await service.pruneExpired();

    expect(revokedTokens.softRemove).toHaveBeenCalledWith([expired]);
  });

  it('prunes by itself every hour once the module is up', async () => {
    service.onModuleInit();
    expect(revokedTokens.find).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(revokedTokens.softRemove).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(revokedTokens.softRemove).toHaveBeenCalledTimes(2);
  });

  it('keeps going after a failed run instead of crashing the process', async () => {
    revokedTokens.find.mockRejectedValueOnce(new Error('database is locked'));
    service.onModuleInit();

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);

    expect(revokedTokens.softRemove).toHaveBeenCalledTimes(1);
  });

  it('stops pruning when the module is destroyed', async () => {
    service.onModuleInit();
    service.onModuleDestroy();

    await vi.advanceTimersByTimeAsync(3 * 60 * 60 * 1000);

    expect(revokedTokens.find).not.toHaveBeenCalled();
  });
});

describe('TokenService.issue', () => {
  const sign = vi.fn(() => 'signed-token');
  const service = new TokenService({ sign } as never, {} as never);
  const user = (isActive: boolean) =>
    ({ id: 'user-1', tokenVersion: 3, isActive }) as never;

  it('signs a token for an active account', () => {
    expect(service.issue(user(true))).toBe('signed-token');
    expect(sign).toHaveBeenCalledWith(
      expect.objectContaining({ sub: 'user-1', tokenVersion: 3 }),
    );
  });

  it('refuses a deactivated account, whichever sign-in path asked', () => {
    sign.mockClear();

    expect(() => service.issue(user(false))).toThrow(UnauthorizedException);
    expect(sign).not.toHaveBeenCalled();
  });
});
