import { IsInt } from 'class-validator';
import { ValidateIf } from 'class-validator';
import { Max } from 'class-validator';
import { Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateInviteDto {
  @ApiProperty({
    required: false,
    example: 1440,
    description: 'Minutes until the link expires. Defaults to 24 hours.',
  })
  // Absent means the default; an explicit null is rejected rather than read as "expires now"
  @ValidateIf((_, value) => value !== undefined)
  @IsInt()
  @Min(1)
  @Max(10080)
  expiresInMinutes: number = 1440;
}
