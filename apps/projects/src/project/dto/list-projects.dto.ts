import { IsIn } from 'class-validator';
import { IsInt } from 'class-validator';
import { IsOptional } from 'class-validator';
import { IsString } from 'class-validator';
import { Max } from 'class-validator';
import { MaxLength } from 'class-validator';
import { Min } from 'class-validator';
import { Transform } from 'class-transformer';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

// import interfaces
import { PROJECT_ROLES } from '../interfaces/project-role.js';
import type { ProjectRole } from '../interfaces/project-role.js';

export const ARCHIVE_FILTERS = ['exclude', 'include', 'only'] as const;
export const PROJECT_SORTS = ['createdAt', 'name'] as const;
export const SORT_ORDERS = ['asc', 'desc'] as const;

export class ListProjectsDto {
  @ApiProperty({
    required: false,
    description: 'Keep projects whose name contains this text.',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiProperty({ required: false, enum: PROJECT_ROLES })
  @IsOptional()
  @IsIn(PROJECT_ROLES)
  role?: ProjectRole;

  @ApiProperty({
    required: false,
    enum: ARCHIVE_FILTERS,
    description:
      'Whether archived projects are left out (the default), included or the only ones.',
  })
  @IsOptional()
  @IsIn(ARCHIVE_FILTERS)
  archived: (typeof ARCHIVE_FILTERS)[number] = 'exclude';

  @ApiProperty({ required: false, enum: PROJECT_SORTS })
  @IsOptional()
  @IsIn(PROJECT_SORTS)
  sort: (typeof PROJECT_SORTS)[number] = 'createdAt';

  @ApiProperty({ required: false, enum: SORT_ORDERS })
  @IsOptional()
  @IsIn(SORT_ORDERS)
  order: (typeof SORT_ORDERS)[number] = 'asc';

  @ApiProperty({ required: false, example: 50, description: '1 to 100.' })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 50;

  @ApiProperty({ required: false, example: 0 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(0)
  offset: number = 0;
}
