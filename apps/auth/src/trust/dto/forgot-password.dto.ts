import { IsEmail } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

// import others
import { NormalizeEmail } from '../../identity/utils/normalize-email.js';

export class ForgotPasswordDto {
  @ApiProperty({ example: 'jane.doe@example.com' })
  @NormalizeEmail()
  @IsEmail()
  email!: string;
}
