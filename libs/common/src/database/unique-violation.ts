import { QueryFailedError } from 'typeorm';

// A unique index refused a write: two requests claimed the same value at once and this one lost
export function isUniqueViolation(error: unknown): error is QueryFailedError {
  return error instanceof QueryFailedError && /UNIQUE/i.test(error.message);
}
