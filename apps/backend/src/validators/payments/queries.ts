import { z } from "zod";

export const PaginationSchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(50),
  offset: z.coerce.number().min(0).default(0),
});

export const PaymentHistoryFilterSchema = z.object({
  tenantId: z.string().uuid().optional(),
  status: z.enum(["UPCOMING", "PAID", "PENDING", "PARTIAL", "OVERDUE", "WAIVED", "ALL"]).optional(),
  method: z.string().optional(),
  month: z.string().regex(/^\d{4}-\d{2}$/, "Must be YYYY-MM").optional(),
}).merge(PaginationSchema);

export const DuesReportQuerySchema = z.object({
  rent_month: z.string().regex(/^\d{4}-\d{2}$/, "Must be YYYY-MM").optional(),
  status: z.enum(["UPCOMING", "PENDING", "PARTIAL", "PAID", "OVERDUE", "WAIVED"]).optional(),
  hostelId: z.string().uuid().optional(),
});

export const AnalyticsFilterSchema = z.object({
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  hostelId: z.string().uuid().optional(),
});
