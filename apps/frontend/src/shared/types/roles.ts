export const USER_ROLES = {
  ADMIN: 'admin',
  OWNER: 'owner',
  TENANT: 'tenant',
  WARDEN: 'warden',
  MANAGER: 'manager',
} as const;

export type UserRole = (typeof USER_ROLES)[keyof typeof USER_ROLES];
