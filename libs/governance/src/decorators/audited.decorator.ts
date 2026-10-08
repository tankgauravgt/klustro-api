import 'reflect-metadata';

const AUDITED_KEY = 'governance:audited';

export interface AuditedOptions {
  // Prefix of the audit action, e.g. `project` gives `project.created`
  name: string;
  // Columns whose values must never be written to the audit log
  redact?: string[];
  // Audience that may read events about this record, e.g. `project:<id>`
  scope?: (entity: any) => string | null;
}

export const Audited =
  (options: AuditedOptions): ClassDecorator =>
  (target) =>
    Reflect.defineMetadata(AUDITED_KEY, options, target);

export const getAuditedOptions = (
  target: unknown,
): AuditedOptions | undefined =>
  Reflect.getMetadata(AUDITED_KEY, target as object) as
    AuditedOptions | undefined;
