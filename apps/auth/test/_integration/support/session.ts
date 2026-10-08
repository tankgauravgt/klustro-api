import type { Response } from 'supertest';

/*
 * The API keeps the access token in an httpOnly cookie, not in the body. This reads it back from
 * `Set-Cookie` so a test can use it as a Bearer token, and checks the cookie's protections.
 */
export function tokenOf(response: Response): string {
  const cookies = (response.headers['set-cookie'] as unknown as string[]) ?? [];
  const session = cookies.find((cookie) => cookie.startsWith('access_token='));
  if (!session) {
    throw new Error(
      `No session cookie in the response (status ${response.status}): ${JSON.stringify(response.body)}`,
    );
  }
  return decodeURIComponent(
    session.split(';')[0].slice('access_token='.length),
  );
}
