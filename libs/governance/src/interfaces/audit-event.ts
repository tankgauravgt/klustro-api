// import others
import type { AuditOutcome } from './audit-outcome.js';

export interface AuditEventInput {
  action: string;
  outcome?: AuditOutcome;
  // Defaults to the actor of the current request, if any
  actorId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  // Groups events for one audience, e.g. `user:<id>` or `project:<id>`
  scope?: string | null;
  changes?: Record<string, unknown> | null;
  metadata?: Record<string, unknown>;
}
