import { ConflictException } from '@nestjs/common';
import { CommandHandler } from '@nestjs/cqrs';
import { ICommandHandler } from '@nestjs/cqrs';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

// import application libraries
import { isUniqueViolation } from '@libs/common';

// import commands
import { ChangeUsernameCommand } from '../change-username.command.js';

// import models
import { User } from '../../models/user.entity.js';

// import others
import { normalizeUsername } from '../../utils/username.js';

@CommandHandler(ChangeUsernameCommand)
export class ChangeUsernameHandler implements ICommandHandler<
  ChangeUsernameCommand,
  void
> {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async execute(command: ChangeUsernameCommand): Promise<void> {
    const username = normalizeUsername(command.username);

    try {
      await this.dataSource.transaction(async (manager) => {
        const usersRepository = manager.getRepository(User);
        const user = await usersRepository.findOneByOrFail({
          id: command.userId,
        });

        // Asking for the name you already have is not an error
        if (user.username === username) {
          return;
        }
        if (await usersRepository.existsBy({ username, isActive: true })) {
          throw new ConflictException('Username already taken');
        }

        // The old name is free as soon as this commits
        user.username = username;
        await usersRepository.save(user);
      });
    } catch (error) {
      // Two people taking the same name at once: the unique index lets only one win
      if (isUniqueViolation(error)) {
        throw new ConflictException('Username already taken');
      }
      throw error;
    }
  }
}
