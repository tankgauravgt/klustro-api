// import others
import type { AuditOutcome } from './audit-outcome.js';

export interface AuditLogEntry {
  sequence: number;
  eventId: string;
  occurredAt: string;
  service: string;
  action: string;
  outcome: AuditOutcome;
  actorId: string | null;
  actorType: 'user' | 'system' | 'anonymous';
  entityType: string | null;
  entityId: string | null;
  scope: string | null;
  changes: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
  hash: string;
}

export interface AuditLogPage {
  items: AuditLogEntry[];
  nextBefore: number | null;
}
