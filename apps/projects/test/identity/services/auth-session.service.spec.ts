import { afterEach } from 'vitest';
import { beforeEach } from 'vitest';
import { describe } from 'vitest';
import { expect } from 'vitest';
import { it } from 'vitest';
import { vi } from 'vitest';
import { ServiceUnavailableException } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';

// import services
import { AuthSessionService } from '../../../src/identity/services/auth-session.service.js';

describe('AuthSessionService', () => {
  const service = new AuthSessionService({
    get: () => 'http://auth.test',
  } as never);
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('asks the auth service with a deadline, so a stalled one cannot hang every request', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 'user-1' }),
    });

    await expect(service.verify('tok')).resolves.toEqual({ id: 'user-1' });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://auth.test/auth/session');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('answers 503 when the auth service does not answer in time', async () => {
    fetchMock.mockRejectedValue(
      new DOMException('The operation timed out.', 'TimeoutError'),
    );

    await expect(service.verify('tok')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('answers 401 when the auth service says the session is over', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401 });

    await expect(service.verify('tok')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
