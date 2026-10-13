import { describe } from 'vitest';
import { expect } from 'vitest';
import { it } from 'vitest';
import { BadRequestException } from '@nestjs/common';

// import pipes
import { INVALID_INVITE_MESSAGE } from '../../../src/invite/pipes/invite-token.pipe.js';
import { InviteTokenPipe } from '../../../src/invite/pipes/invite-token.pipe.js';

describe('InviteTokenPipe', () => {
  const pipe = new InviteTokenPipe();

  it.each(['0'.repeat(64), 'abcdef0123456789'.repeat(4), 'f'.repeat(64)])(
    'passes a 64 character lower-case hex token through unchanged',
    (token) => {
      expect(pipe.transform(token)).toBe(token);
    },
  );

  it.each([
    ['empty', ''],
    ['short', 'abc'],
    ['63 characters', 'a'.repeat(63)],
    ['65 characters', 'a'.repeat(65)],
    ['upper case', 'A'.repeat(64)],
    ['not hex', 'g'.repeat(64)],
    ['padded with a space', ` ${'a'.repeat(63)}`],
    ['with a trailing newline', `${'a'.repeat(64)}\n`],
    ['two tokens joined', `${'a'.repeat(64)}${'b'.repeat(64)}`],
    ['path traversal', `../${'a'.repeat(61)}`],
  ])('rejects a token that is %s with 400', (_label, token) => {
    expect(() => pipe.transform(token)).toThrow(BadRequestException);
    expect(() => pipe.transform(token)).toThrow(INVALID_INVITE_MESSAGE);
  });

  it('rejects a value that is not text', () => {
    expect(() => pipe.transform(undefined as never)).toThrow(
      BadRequestException,
    );
    expect(() => pipe.transform(null as never)).toThrow(BadRequestException);
  });
});
