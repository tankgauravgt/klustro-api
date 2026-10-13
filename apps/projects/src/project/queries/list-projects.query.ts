// import dtos
import type { ListProjectsDto } from '../dto/list-projects.dto.js';

export class ListProjectsQuery {
  constructor(
    public readonly userId: string,
    public readonly filter: ListProjectsDto,
  ) {}
}
