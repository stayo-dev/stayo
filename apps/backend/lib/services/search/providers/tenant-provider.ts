import { prisma } from "../../../db";
import { financialService } from "../../../../src/services/payments/financial-service";
import { bestScore, sortByScore, SCORE } from "../ranking";
import type { SearchProvider, SearchResult } from "../types";

/**
 * Tenant search — name, phone (any of four fields), room, hostel, roll number,
 * email, plus the word "invited" for tenants who haven't activated.
 *
 * Deliberately does **not** reuse `/api/payments/quick-collect/search`: that
 * route issues a per-tenant obligations query *and* a ledger-balance query for
 * every hit — 40 round-trips for 20 results — which is fine for a deliberate
 * payment flow and far too heavy for a typeahead firing on each keystroke.
 * Outstanding here comes from ONE grouped aggregate across all matched
 * tenants. The dues figure is still the obligation rows, not an independently
 * invented number.
 */

const ACTIVE_STATUSES = ["ACTIVE", "INVITED"] as const;

export const tenantProvider: SearchProvider = {
  type: "TENANT",
  label: "Tenants",
  order: 1,

  async search({ ownerId, query, limit }) {
    const q = query.trim();
    if (!q) return [];

    const digits = q.replace(/\D/g, "");
    const wantsInvited = /^invit/i.test(q);

    const tenants = await prisma.tenants.findMany({
      where: {
        owner_id: ownerId,
        // Narrowed to INVITED when the owner literally typed "invited",
        // otherwise both live statuses. Written as one key rather than a
        // spread that overwrites an earlier `status` — that silently relied on
        // key order and TypeScript rightly flags it.
        status: wantsInvited ? "INVITED" : { in: [...ACTIVE_STATUSES] },
        ...(wantsInvited
          ? {}
          : {
              OR: [
                { profiles: { name: { contains: q, mode: "insensitive" } } },
                { profiles: { email: { contains: q, mode: "insensitive" } } },
                ...(digits
                  ? [
                      { profiles: { phone: { contains: digits } } },
                      { phone_1: { contains: digits } },
                      { phone_2: { contains: digits } },
                      { phone_3: { contains: digits } },
                    ]
                  : []),
                { roll_number: { contains: q, mode: "insensitive" } },
                { personal_email: { contains: q, mode: "insensitive" } },
                { hostels: { name: { contains: q, mode: "insensitive" } } },
                {
                  room_allocations: {
                    some: {
                      is_active: true,
                      end_date: null,
                      room: { room_no: { contains: q, mode: "insensitive" } },
                    },
                  },
                },
              ],
            }),
      },
      select: {
        id: true,
        status: true,
        phone_1: true,
        roll_number: true,
        hostel_id: true,
        profiles: { select: { name: true, phone: true, email: true } },
        hostels: { select: { name: true } },
        room_allocations: {
          where: { is_active: true, end_date: null },
          select: { room: { select: { room_no: true } } },
          take: 1,
        },
      },
      // Over-fetch a little so ranking has something to choose between, then
      // trim after scoring.
      take: Math.max(limit * 3, 30),
    });

    if (tenants.length === 0) return [];

    // ONE query for every matched tenant's obligations, then the *canonical*
    // summary computed per tenant over those in-memory rows.
    // `getTenantPaymentSummary` is sync and takes pre-fetched rows for exactly
    // this reason — outstanding is never re-derived here (CLAUDE.md: compose,
    // don't reimplement; obligations are the source of truth for money owed).
    const obligations = await prisma.rent_obligations.findMany({
      where: {
        tenant_id: { in: tenants.map((t: any) => t.id) },
        is_superseded: false,
        status: { in: ["PENDING", "PARTIAL", "OVERDUE"] },
      },
      include: { payments: { select: { amount_paid: true, payment_date: true } } },
    });

    const obligationsByTenant = new Map<string, any[]>();
    for (const ob of obligations as any[]) {
      const list = obligationsByTenant.get(ob.tenant_id);
      if (list) list.push(ob);
      else obligationsByTenant.set(ob.tenant_id, [ob]);
    }

    const outstandingByTenant = new Map<string, number>(
      tenants.map((t: any) => [
        t.id,
        financialService.getTenantPaymentSummary(t.id, (obligationsByTenant.get(t.id) ?? []) as any)
          .pending_amount,
      ]),
    );

    const results: SearchResult[] = tenants.map((t: any) => {
      const name = t.profiles?.name || "Tenant";
      const phone = t.profiles?.phone || t.phone_1 || "";
      const room = t.room_allocations?.[0]?.room?.room_no ?? null;
      const hostelName = t.hostels?.name ?? "";
      const outstanding = outstandingByTenant.get(t.id) ?? 0;
      const isInvited = t.status === "INVITED";

      const score = wantsInvited
        ? SCORE.FUZZY
        : bestScore(q, [
            { value: name, field: "name" },
            { value: t.profiles?.phone, field: "phone" },
            { value: t.phone_1, field: "phone" },
            { value: room, field: "room" },
            { value: hostelName, field: "hostel" },
          ]) ||
          // Matched on something secondary (email, roll number) — the SQL found
          // it, so it is a hit, just a weak one.
          SCORE.FUZZY;

      const where = [room ? `Room ${room}` : "No room yet", hostelName].filter(Boolean).join(" · ");

      return {
        type: "TENANT" as const,
        id: t.id,
        title: name,
        subtitle: where,
        meta: isInvited
          ? "Invited"
          : outstanding > 0
            ? `₹${outstanding.toLocaleString("en-IN")} overdue`
            : "Up to date",
        metaTone: isInvited ? ("warning" as const) : outstanding > 0 ? ("destructive" as const) : ("success" as const),
        href: `/owner/tenants/${t.id}`,
        score,
        data: { phone, hostelId: t.hostel_id, room, outstanding, invited: isInvited },
      };
    });

    return sortByScore(results).slice(0, limit);
  },
};
