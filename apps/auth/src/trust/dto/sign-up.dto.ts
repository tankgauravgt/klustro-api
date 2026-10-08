import { IsEmail } from 'class-validator';
import { IsOptional } from 'class-validator';
import { IsByteLength } from 'class-validator';
import { IsString } from 'class-validator';
import { MaxLength } from 'class-validator';
import { MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

// import others
import { NormalizeEmail } from '../../identity/utils/normalize-email.js';
import { IsUsername } from '../../identity/utils/username.js';

export class SignUpDto {
  @ApiProperty({
    example: 'jane.doe',
    description:
      '3 to 32 characters: lowercase letters, digits, dots, dashes, underscores.',
  })
  @IsUsername()
  username!: string;

  @ApiProperty({ example: 'Jane' })
  @IsString()
  @MaxLength(100)
  firstName!: string;

  @ApiProperty({ example: 'Doe' })
  @IsString()
  @MaxLength(100)
  lastName!: string;

  @ApiProperty({ example: 'jane.doe@example.com' })
  @NormalizeEmail()
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'S3curePassw0rd!' })
  @IsString()
  @MinLength(8)
  // bcrypt only reads the first 72 bytes; refuse what it would silently cut off
  @IsByteLength(0, 72, { message: 'Password may be at most 72 bytes long' })
  password!: string;

  @ApiProperty({
    required: false,
    description:
      'Only sent after the API answered `password_required`: the password of the existing account that already owns this email.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  existingAccountPassword?: string;
}
