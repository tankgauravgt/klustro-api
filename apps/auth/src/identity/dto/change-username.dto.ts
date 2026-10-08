import { ApiProperty } from '@nestjs/swagger';

// import others
import { IsUsername } from '../utils/username.js';

export class ChangeUsernameDto {
  @ApiProperty({
    example: 'jane.doe',
    description:
      '3 to 32 characters: lowercase letters, digits, dots, dashes, underscores. Uppercase is lowered.',
  })
  @IsUsername()
  username!: string;
}
