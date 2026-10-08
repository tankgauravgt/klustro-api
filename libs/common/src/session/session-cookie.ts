export const ACCESS_TOKEN_COOKIE = 'access_token';

// JavaScript cannot read it (httpOnly), it is only sent to the same site (strict), and only over
// HTTPS; browsers also accept it on http://localhost.
export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: 'strict',
  path: '/',
} as const;

interface RequestWithHeaders {
  headers: { authorization?: string; cookie?: string };
}

// The value of one cookie from the request's Cookie header, or null
export function readCookie(
  request: RequestWithHeaders,
  name: string,
): string | null {
  for (const part of (request.headers.cookie ?? '').split(';')) {
    const separator = part.indexOf('=');
    if (separator !== -1 && part.slice(0, separator).trim() === name) {
      try {
        return decodeURIComponent(part.slice(separator + 1).trim()) || null;
      } catch {
        return null;
      }
    }
  }
  return null;
}

/*
 * The access token of a request: an `Authorization: Bearer` header (API tools, Swagger) wins,
 * otherwise the session cookie the web app uses.
 */
export function extractAccessToken(request: RequestWithHeaders): string | null {
  const authorization = request.headers.authorization;
  if (authorization?.startsWith('Bearer ')) {
    return authorization.slice('Bearer '.length).trim() || null;
  }
  return readCookie(request, ACCESS_TOKEN_COOKIE);
}
