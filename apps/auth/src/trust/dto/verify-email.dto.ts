import { IsString } from 'class-validator';
import { Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class VerifyEmailDto {
  @ApiProperty({
    description: 'The token from the verification link (64 hex characters).',
  })
  @IsString()
  @Length(64, 64)
  token!: string;
}
