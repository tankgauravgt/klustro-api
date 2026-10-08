import { IsOptional } from 'class-validator';
import { IsByteLength } from 'class-validator';
import { IsString } from 'class-validator';
import { MaxLength } from 'class-validator';
import { MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class SetPasswordDto {
  @ApiProperty({ example: 'S3curePassw0rd!' })
  @IsString()
  @MinLength(8)
  // bcrypt only reads the first 72 bytes; refuse what it would silently cut off
  @IsByteLength(0, 72, { message: 'Password may be at most 72 bytes long' })
  password!: string;

  @ApiPropertyOptional({
    description:
      'Required when the account already has a password; ignored when it has none yet (first-time setup after signing in with Google or GitHub).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  currentPassword?: string;
}
