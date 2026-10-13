import { ArrayMaxSize } from 'class-validator';
import { ArrayMinSize } from 'class-validator';
import { ArrayUnique } from 'class-validator';
import { IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LookupUsersDto {
  @ApiProperty({ type: [String], description: '1 to 100 user ids.' })
  @IsUUID('all', { each: true })
  @ArrayUnique()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  ids!: string[];
}
