// @deprecated Zero consumers anywhere in the app — every real caller imports
// directly from the underlying @features/*/api module instead. See
// docs/migration/frontend-foundation-tracker.md. Do not import in new code.
export { authService, identityService } from '@features/auth/api';
export { ownerService } from '@features/owners/api';
export { dashboardService, portfolioService } from '@features/dashboard/api';
export { tenantService } from '@features/tenants/api';
export { paymentService, rentService } from '@features/payments/api';
export { expenseService } from '@features/expenses/api';
export { notificationService, reminderService } from '@features/notifications/api';
export { analyticsService, activityService } from '@features/reports/api';
export { activityListService } from '@features/activity/api';
export { moveOutService } from '@features/move-out/api';
export { roomService, allocationService } from '@features/rooms/api';
