import { Injectable } from '@nestjs/common';
import { ServiceUnavailableException } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';

// import application libraries
import { OUTBOUND_REQUEST_TIMEOUT_MS } from '@libs/common';
import { resolveAddress } from '@libs/common';

import type { AuthenticatedUser } from '../interfaces/authenticated-user.js';

/*
 * Asks the auth service, on every request, whether a token is still good. The auth service owns
 * logout, password resets and account status, so this is what makes them take effect here at once.
 */
@Injectable()
export class AuthSessionService {
  async verify(token: string): Promise<AuthenticatedUser> {
    const authAddress = resolveAddress('auth');
    if (!authAddress) {
      throw new ServiceUnavailableException(
        'Authentication service is unreachable',
      );
    }

    let response: Response;
    try {
      response = await fetch(`${authAddress}/auth/session`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(OUTBOUND_REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new ServiceUnavailableException(
        'Authentication service is unreachable',
      );
    }

    if (response.status === 401 || response.status === 403) {
      throw new UnauthorizedException('Session is no longer valid');
    }
    if (!response.ok) {
      throw new ServiceUnavailableException('Authentication service failed');
    }
    return (await response.json()) as AuthenticatedUser;
  }
}
