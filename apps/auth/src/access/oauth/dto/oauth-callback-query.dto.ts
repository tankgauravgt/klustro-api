import { IsOptional } from 'class-validator';
import { IsString } from 'class-validator';

// What the provider adds to the callback URL
export class OAuthCallbackQueryDto {
  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsString()
  state?: string;

  // Set by the provider when the person declined, e.g. `access_denied`
  @IsOptional()
  @IsString()
  error?: string;
}
