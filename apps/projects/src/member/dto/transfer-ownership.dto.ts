import { IsString } from 'class-validator';
import { IsNotEmpty } from 'class-validator';
import { MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class TransferOwnershipDto {
  @ApiProperty({ description: 'The member who becomes an owner.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  userId!: string;
}
