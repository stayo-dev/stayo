import { prisma } from "../../lib/db";
import { Prisma } from "@prisma/client";

export class PaymentRepository {
    // --- Generic Prisma Wrappers ---
    async findUnique(args: Prisma.paymentsFindUniqueArgs) {
        return await prisma.payments.findUnique(args);
    }

    async findFirst(args: Prisma.paymentsFindFirstArgs) {
        return await prisma.payments.findFirst(args);
    }

    async findMany(args: Prisma.paymentsFindManyArgs) {
        return await prisma.payments.findMany(args);
    }

    async count(args: Prisma.paymentsCountArgs) {
        return await prisma.payments.count(args);
    }

    async create(args: Prisma.paymentsCreateArgs) {
        return await prisma.payments.create(args);
    }

    async update(args: Prisma.paymentsUpdateArgs) {
        return await prisma.payments.update(args);
    }

    async aggregate(args: Prisma.paymentsAggregateArgs) {
        return await prisma.payments.aggregate(args);
    }

    async groupBy(args: Prisma.paymentsGroupByArgs) {
        return await prisma.payments.groupBy(args);
    }

    async transaction<T>(fn: (tx: Omit<Prisma.TransactionClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">) => Promise<T>) {
        return await prisma.$transaction(fn);
    }

    // --- Domain-Specific Read Queries ---

    async getObligationsWithPayments(
        ownerId: string, 
        hostelId: string, 
        filters?: { tenantId?: string; method?: string; month?: string }
    ) {
        const month = typeof filters?.month === "string" && /^\d{4}-\d{2}$/.test(filters.month)
            ? filters.month
            : undefined;

        const monthStart = month ? new Date(`${month}-01T00:00:00.000Z`) : undefined;
        const nextMonthStart = monthStart
            ? new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 1, 0, 0, 0, 0))
            : undefined;

        return await prisma.rent_obligations.findMany({
            where: {
                owner_id: ownerId,
                hostel_id: hostelId,
                ...(filters?.tenantId ? { tenant_id: filters.tenantId } : {}),
                ...(monthStart && nextMonthStart ? { rent_month: { gte: monthStart, lt: nextMonthStart } } : {})
            },
            include: {
                tenants: { include: { profiles: true } },
                room_allocations: { include: { room: true } },
                payments: {
                    where: {
                        ...(filters?.method ? { payment_method: filters.method } : {})
                    },
                    orderBy: { payment_date: "desc" }
                }
            },
            orderBy: [{ rent_month: "desc" }, { due_date: "desc" }]
        });
    }

    async getDuesReportData(ownerId: string, hostelId: string, rentMonth?: Date, status?: string) {
        return await prisma.rent_obligations.findMany({
            where: {
                owner_id: ownerId,
                hostel_id: hostelId,
                ...(rentMonth && { rent_month: rentMonth }),
                ...(status ? { status: status as any } : {})
            },
            select: {
                id: true,
                tenant_id: true,
                hostel_id: true,
                rent_month: true,
                due_date: true,
                amount: true,
                total_amount: true,
                late_fee: true,
                obligation_type: true,
                status: true,
                tenants: {
                    select: {
                        photo_url: true,
                        profiles: {
                            select: {
                                name: true,
                                email: true,
                                phone: true
                            }
                        }
                    }
                },
                room_allocations: {
                    select: {
                        room: {
                            select: {
                                room_no: true
                            }
                        }
                    }
                },
                payments: {
                    select: {
                        amount_paid: true
                    }
                }
            },
            orderBy: { rent_month: "desc" }
        });
    }
}

export const paymentRepository = new PaymentRepository();
