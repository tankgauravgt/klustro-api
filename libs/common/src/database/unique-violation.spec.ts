import { describe } from 'vitest';
import { expect } from 'vitest';
import { it } from 'vitest';
import { QueryFailedError } from 'typeorm';

import { isUniqueViolation } from './unique-violation.js';

describe('isUniqueViolation', () => {
  it('recognises a unique index refusing a write', () => {
    const error = new QueryFailedError(
      'INSERT',
      [],
      new Error('UNIQUE constraint failed: users.username'),
    );

    expect(isUniqueViolation(error)).toBe(true);
  });

  it('does not mistake other database failures for it', () => {
    const error = new QueryFailedError(
      'INSERT',
      [],
      new Error('NOT NULL constraint failed: users.username'),
    );

    expect(isUniqueViolation(error)).toBe(false);
  });

  it('ignores errors that did not come from the database', () => {
    expect(isUniqueViolation(new Error('UNIQUE'))).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
  });
});
