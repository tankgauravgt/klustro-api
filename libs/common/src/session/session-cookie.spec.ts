import { describe } from 'vitest';
import { expect } from 'vitest';
import { it } from 'vitest';

// import services
import { extractAccessToken } from './session-cookie.js';

const request = (headers: { authorization?: string; cookie?: string }) => ({
  headers,
});

describe('extractAccessToken', () => {
  it('reads a Bearer header', () => {
    expect(extractAccessToken(request({ authorization: 'Bearer abc' }))).toBe(
      'abc',
    );
  });

  it('reads the session cookie among other cookies', () => {
    expect(
      extractAccessToken(request({ cookie: 'a=1; access_token=xyz; b=2' })),
    ).toBe('xyz');
  });

  it('prefers the header over the cookie', () => {
    expect(
      extractAccessToken(
        request({ authorization: 'Bearer header', cookie: 'access_token=c' }),
      ),
    ).toBe('header');
  });

  it('returns null when there is nothing, or something else', () => {
    expect(extractAccessToken(request({}))).toBeNull();
    expect(extractAccessToken(request({ cookie: 'other=1' }))).toBeNull();
    expect(
      extractAccessToken(request({ authorization: 'Basic abc' })),
    ).toBeNull();
    expect(extractAccessToken(request({ cookie: 'access_token=' }))).toBeNull();
  });

  it('does not match a cookie whose name only ends the same way', () => {
    expect(
      extractAccessToken(request({ cookie: 'not_access_token=evil' })),
    ).toBeNull();
  });

  it('ignores a malformed cookie value instead of throwing', () => {
    expect(
      extractAccessToken(request({ cookie: 'access_token=%E0%A4%A' })),
    ).toBeNull();
  });
});
