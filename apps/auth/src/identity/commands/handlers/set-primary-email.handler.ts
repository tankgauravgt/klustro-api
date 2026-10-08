import { BadRequestException } from '@nestjs/common';
import { NotFoundException } from '@nestjs/common';
import { CommandHandler } from '@nestjs/cqrs';
import { ICommandHandler } from '@nestjs/cqrs';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

// import commands
import { SetPrimaryEmailCommand } from '../set-primary-email.command.js';

// import models
import { Email } from '../../models/email.entity.js';
import { User } from '../../models/user.entity.js';

@CommandHandler(SetPrimaryEmailCommand)
export class SetPrimaryEmailHandler implements ICommandHandler<
  SetPrimaryEmailCommand,
  void
> {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async execute(command: SetPrimaryEmailCommand): Promise<void> {
    const { userId, emailId } = command;

    await this.dataSource.transaction(async (manager) => {
      const emailsRepository = manager.getRepository(Email);

      const target = await emailsRepository.findOne({
        where: { id: emailId, userId },
      });
      if (!target) {
        throw new NotFoundException('Email not found for this account');
      }
      if (target.isPrimary) {
        return;
      }
      if (!target.isVerified) {
        throw new BadRequestException(
          'Only a verified email can be made primary',
        );
      }

      const previous = await emailsRepository.find({
        where: { userId, isPrimary: true },
      });
      for (const email of previous) {
        email.isPrimary = false;
      }
      await emailsRepository.save(previous);

      target.isPrimary = true;
      await emailsRepository.save(target);

      const usersRepository = manager.getRepository(User);
      const user = await usersRepository.findOneByOrFail({ id: userId });
      user.email = target.email;
      await usersRepository.save(user);
    });
  }
}
