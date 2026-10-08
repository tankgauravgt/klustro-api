import { Transform } from 'class-transformer';

export const normalizeEmail = (value: string): string =>
  value.trim().toLowerCase();

// Addresses are compared exactly, so `Jane@X.com` and `jane@x.com` must become the same value
export const NormalizeEmail = (): PropertyDecorator =>
  Transform(({ value }) =>
    typeof value === 'string' ? normalizeEmail(value) : value,
  );
