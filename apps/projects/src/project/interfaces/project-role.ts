export const PROJECT_ROLES = ['owner', 'member'] as const;

export type ProjectRole = (typeof PROJECT_ROLES)[number];
