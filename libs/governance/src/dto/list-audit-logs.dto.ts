import { IsInt } from 'class-validator';
import { IsOptional } from 'class-validator';
import { Max } from 'class-validator';
import { Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class ListAuditLogsDto {
  @ApiProperty({ required: false, example: 50, description: '1 to 200.' })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  limit: number = 50;

  @ApiProperty({
    required: false,
    description: 'Return entries older than this sequence number.',
  })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  before?: number;
}
