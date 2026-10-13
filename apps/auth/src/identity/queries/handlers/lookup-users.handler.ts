import { IQueryHandler } from '@nestjs/cqrs';
import { QueryHandler } from '@nestjs/cqrs';
import { InjectRepository } from '@nestjs/typeorm';
import { In } from 'typeorm';
import { Repository } from 'typeorm';

// import queries
import { LookupUsersQuery } from '../lookup-users.query.js';

// import models
import { User } from '../../models/user.entity.js';

// Just enough to name a person in someone else's list: no email, no account state
export interface UserCard {
  id: string;
  username: string;
  displayName: string;
}

@QueryHandler(LookupUsersQuery)
export class LookupUsersHandler implements IQueryHandler<
  LookupUsersQuery,
  UserCard[]
> {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
  ) {}

  // Ids that match no active account are left out of the answer
  async execute(query: LookupUsersQuery): Promise<UserCard[]> {
    const users = await this.usersRepository.find({
      where: { id: In(query.ids), isActive: true },
    });
    return users.map((user) => ({
      id: user.id,
      username: user.username,
      displayName:
        [user.firstName, user.lastName]
          .filter((part) => part?.trim())
          .join(' ')
          .trim() || user.username,
    }));
  }
}
