import { IsIn } from 'class-validator';
import { IsNotEmpty } from 'class-validator';
import { IsString } from 'class-validator';
import { MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

// import interfaces
import { MESH_PROVIDERS } from '../interfaces/mesh-provider.js';
import type { MeshProvider } from '../interfaces/mesh-provider.js';

export class CreateProjectDto {
  @ApiProperty({ example: 'Homelab Cluster' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @ApiProperty({
    enum: MESH_PROVIDERS,
    description: 'Cannot be changed after the project is created.',
  })
  @IsIn(MESH_PROVIDERS)
  meshProvider!: MeshProvider;
}
