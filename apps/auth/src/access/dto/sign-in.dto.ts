import { IsString } from 'class-validator';
import { MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SignInDto {
  @ApiProperty({
    description: 'Either a username or an email address.',
    example: 'jane.doe',
  })
  @IsString()
  @MaxLength(254)
  identifier!: string;

  @ApiProperty({ example: 'S3curePassw0rd!' })
  @IsString()
  @MaxLength(256)
  password!: string;
}
