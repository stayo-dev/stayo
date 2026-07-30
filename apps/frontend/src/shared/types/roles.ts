export const USER_ROLES = {
  ADMIN: 'admin',
  OWNER: 'owner',
  TENANT: 'tenant',
  WARDEN: 'warden',
} as const;

export type UserRole = (typeof USER_ROLES)[keyof typeof USER_ROLES];
