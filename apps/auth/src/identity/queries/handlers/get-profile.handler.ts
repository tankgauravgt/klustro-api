import { NotFoundException } from '@nestjs/common';
import { IQueryHandler } from '@nestjs/cqrs';
import { QueryHandler } from '@nestjs/cqrs';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

// import queries
import { GetProfileQuery } from '../get-profile.query.js';

// import models
import { User } from '../../models/user.entity.js';

export interface ProfileResult {
  id: string;
  username: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  requiresPasswordSetup: boolean;
}

@QueryHandler(GetProfileQuery)
export class GetProfileHandler implements IQueryHandler<
  GetProfileQuery,
  ProfileResult
> {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
  ) {}

  async execute(query: GetProfileQuery): Promise<ProfileResult> {
    const user = await this.usersRepository.findOne({
      where: { id: query.userId },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    return {
      id: user.id,
      username: user.username,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      requiresPasswordSetup: user.requiresPasswordSetup,
    };
  }
}
