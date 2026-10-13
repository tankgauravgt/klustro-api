import { IQueryHandler } from '@nestjs/cqrs';
import { QueryHandler } from '@nestjs/cqrs';

// import application libraries
import { AuditService } from '@libs/governance';

// import features
import { ProjectAccessService } from '../../../project/index.js';

// import queries
import { VerifyProjectAuditQuery } from '../verify-project-audit.query.js';

// import interfaces
import type { AuditVerification } from '../../interfaces/activity.js';

@QueryHandler(VerifyProjectAuditQuery)
export class VerifyProjectAuditHandler implements IQueryHandler<
  VerifyProjectAuditQuery,
  AuditVerification
> {
  constructor(
    private readonly access: ProjectAccessService,
    private readonly audit: AuditService,
  ) {}

  /*
   * The hash chain runs through the whole service's trail, not one project's, so this checks all of
   * it and says only whether it is intact: counts and positions would tell about other projects.
   */
  async execute(query: VerifyProjectAuditQuery): Promise<AuditVerification> {
    const { userId, projectId } = query;
    await this.access.requireOwner(userId, projectId, 'project.audit.verify');

    const { valid } = await this.audit.verifyIntegrity();
    return { valid };
  }
}
