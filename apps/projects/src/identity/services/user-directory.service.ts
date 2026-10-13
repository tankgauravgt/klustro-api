import { Injectable } from '@nestjs/common';

// import application libraries
import { OUTBOUND_REQUEST_TIMEOUT_MS } from '@libs/common';
import { resolveAddress } from '@libs/common';

export interface UserCard {
  id: string;
  username: string;
  displayName: string;
}

/*
 * Names people by asking the auth service, which owns accounts. It acts for the signed-in caller,
 * using their own token. A name is a nicety, so when auth cannot answer the result is just empty.
 */
@Injectable()
export class UserDirectoryService {
  async lookup(
    authorization: string | undefined,
    ids: string[],
  ): Promise<Map<string, UserCard>> {
    const authAddress = resolveAddress('auth');
    if (!authorization || !authAddress || ids.length === 0) {
      return new Map();
    }

    try {
      const response = await fetch(`${authAddress}/auth/users/lookup`, {
        method: 'POST',
        headers: {
          Authorization: authorization,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ids: [...new Set(ids)].slice(0, 100) }),
        signal: AbortSignal.timeout(OUTBOUND_REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        return new Map();
      }
      const cards = (await response.json()) as UserCard[];
      return new Map(cards.map((card) => [card.id, card]));
    } catch {
      return new Map();
    }
  }
}
