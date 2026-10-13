import { BadRequestException } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import type { PipeTransform } from '@nestjs/common';

// Tokens are 32 random bytes in hex; anything else cannot be a real link, so it never reaches the database
const TOKEN_FORMAT = /^[0-9a-f]{64}$/;

export const INVALID_INVITE_MESSAGE = 'Invite link is invalid or has expired';

@Injectable()
export class InviteTokenPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!TOKEN_FORMAT.test(value)) {
      throw new BadRequestException(INVALID_INVITE_MESSAGE);
    }
    return value;
  }
}
