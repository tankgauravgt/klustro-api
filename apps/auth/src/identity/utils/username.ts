import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsString } from 'class-validator';
import { Length } from 'class-validator';
import { Matches } from 'class-validator';

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 32;

// Lowercase letters, digits, dot, dash and underscore. No spaces.
export const USERNAME_PATTERN = /^[a-z0-9._-]+$/;

// `Alice` and `alice` are the same name, so names are stored and compared in lowercase
export const normalizeUsername = (value: string): string =>
  value.trim().toLowerCase();

export const IsUsername = (): PropertyDecorator =>
  applyDecorators(
    Transform(({ value }) =>
      typeof value === 'string' ? normalizeUsername(value) : value,
    ),
    IsString(),
    Length(USERNAME_MIN_LENGTH, USERNAME_MAX_LENGTH),
    Matches(USERNAME_PATTERN, {
      message:
        'Username may only contain lowercase letters, digits, dots, dashes and underscores',
    }),
  );
