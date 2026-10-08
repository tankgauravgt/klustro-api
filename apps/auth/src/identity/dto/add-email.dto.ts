import { IsEmail } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

// import others
import { NormalizeEmail } from '../utils/normalize-email.js';

export class AddEmailDto {
  @ApiProperty({ example: 'jane.doe.work@example.com' })
  @NormalizeEmail()
  @IsEmail()
  email!: string;
}
