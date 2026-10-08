// import dtos
import type { CreateProjectDto } from '../dto/create-project.dto.js';

export class CreateProjectCommand {
  constructor(
    public readonly userId: string,
    public readonly dto: CreateProjectDto,
  ) {}
}
