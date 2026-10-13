import { NotFoundException } from '@nestjs/common';
import { CommandHandler } from '@nestjs/cqrs';
import { ICommandHandler } from '@nestjs/cqrs';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

// import features
import { ProjectAccessService } from '../../../project/index.js';
import { ProjectInvite } from '../../../project/index.js';

// import commands
import { RevokeInviteCommand } from '../revoke-invite.command.js';

@CommandHandler(RevokeInviteCommand)
export class RevokeInviteHandler implements ICommandHandler<
  RevokeInviteCommand,
  void
> {
  constructor(
    @InjectRepository(ProjectInvite)
    private readonly invitesRepository: Repository<ProjectInvite>,
    private readonly access: ProjectAccessService,
  ) {}

  async execute(command: RevokeInviteCommand): Promise<void> {
    const { userId, projectId, inviteId } = command;
    await this.access.requireOwner(userId, projectId, 'project.invite.revoke');

    // Looked up within the project, so an owner cannot reach another project's invites
    const invite = await this.invitesRepository.findOne({
      where: { id: inviteId, projectId },
    });
    if (!invite) {
      throw new NotFoundException('Invite not found');
    }
    await this.invitesRepository.softRemove(invite);
  }
}
