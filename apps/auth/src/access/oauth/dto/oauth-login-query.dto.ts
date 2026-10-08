import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional } from 'class-validator';
import { IsString } from 'class-validator';

export class OAuthLoginQueryDto {
  @ApiPropertyOptional({
    example: '/projects',
    description:
      'Where in the web app to land after signing in (a path on the app).',
  })
  @IsOptional()
  @IsString()
  returnUrl?: string;
}
