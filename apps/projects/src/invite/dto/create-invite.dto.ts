import { IsIn } from 'class-validator';
import { IsInt } from 'class-validator';
import { ValidateIf } from 'class-validator';
import { Max } from 'class-validator';
import { Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

// import features
import { PROJECT_ROLES } from '../../project/index.js';
import type { ProjectRole } from '../../project/index.js';

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

  @ApiProperty({
    required: false,
    enum: PROJECT_ROLES,
    description:
      'The role whoever accepts the invite gets. Defaults to member.',
  })
  @ValidateIf((_, value) => value !== undefined)
  @IsIn(PROJECT_ROLES)
  role: ProjectRole = 'member';
}
