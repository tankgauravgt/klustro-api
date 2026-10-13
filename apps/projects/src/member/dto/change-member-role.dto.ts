import { IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

// import features
import { PROJECT_ROLES } from '../../project/index.js';
import type { ProjectRole } from '../../project/index.js';

export class ChangeMemberRoleDto {
  @ApiProperty({ enum: PROJECT_ROLES })
  @IsIn(PROJECT_ROLES)
  role!: ProjectRole;
}
