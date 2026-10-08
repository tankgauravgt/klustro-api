import { IsString } from 'class-validator';
import { MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ResetPasswordDto {
  @ApiProperty({
    description:
      'The raw token from the reset link (the `token` query parameter).',
    example: '12a9b675788564cf6322fb7d49a7810fb791728eef601ca110d5b38f3d04734',
  })
  @IsString()
  token!: string;

  @ApiProperty({ example: 'N3wS3curePassw0rd!' })
  @IsString()
  @MinLength(8)
  newPassword!: string;
}
