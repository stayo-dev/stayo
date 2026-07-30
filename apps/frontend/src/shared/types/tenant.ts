export const TENANT_STATUS = {
  ACTIVE: 'ACTIVE',
  INVITED: 'INVITED',
  INACTIVE: 'INACTIVE',
  MOVED_OUT: 'MOVED_OUT',
} as const;

export type TenantStatus = (typeof TENANT_STATUS)[keyof typeof TENANT_STATUS];
