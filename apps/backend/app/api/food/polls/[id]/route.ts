export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { prisma } from "@/lib/db";
import { validatePollOptionEdits, type RequestedPollOption } from "@/lib/services/food/poll-edit-validation";

/**
 * PATCH /api/food/polls/[id]
 * Edit an already-published (OPEN) poll — title, poll_date, closes_at,
 * is_anonymous, allow_multiple, and the option list (edit label, add new,
 * remove a zero-vote option). `poll_type` is intentionally not editable —
 * switching SINGLE_CHOICE/MULTIPLE_CHOICE after votes exist would corrupt
 * their meaning. Closing this gap ADR-057/Food.md §16 flagged as "not built",
 * not reversing a considered decision.
 * Body: { title?, pollDate?, closesAt?, isAnonymous?, allowMultiple?, options?: { id?, label }[] }
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  const { id } = await params;

  try {
    const scope = resolveOwnerScope(session);
    const body = await req.json().catch(() => ({}));

    const poll = await prisma.food_polls.findFirst({
      where: { id, owner_id: scope.owner_id },
      include: { food_poll_options: true },
    });
    if (!poll) return apiError("Poll not found", "NOT_FOUND", 404);
    if (poll.status !== "OPEN") {
      return apiError("Only an open poll can be edited", "POLL_CLOSED", 409);
    }

    const data: {
      title?: string;
      poll_date?: Date;
      closes_at?: Date;
      is_anonymous?: boolean;
      allow_multiple?: boolean;
      updated_at: Date;
    } = { updated_at: new Date() };

    if (typeof body.title === "string") {
      const trimmed = body.title.trim();
      if (!trimmed) return apiError("title cannot be empty", "VALIDATION_ERROR", 400);
      data.title = trimmed;
    }
    if (typeof body.pollDate === "string") {
      const pollDateValue = new Date(`${body.pollDate}T00:00:00.000Z`);
      if (Number.isNaN(pollDateValue.getTime())) {
        return apiError("pollDate must be a valid date (YYYY-MM-DD)", "VALIDATION_ERROR", 400);
      }
      data.poll_date = pollDateValue;
    }
    if (typeof body.closesAt === "string") {
      const closesAtValue = new Date(body.closesAt);
      if (Number.isNaN(closesAtValue.getTime())) {
        return apiError("closesAt must be a valid date/time", "VALIDATION_ERROR", 400);
      }
      data.closes_at = closesAtValue;
    }
    if (typeof body.isAnonymous === "boolean") data.is_anonymous = body.isAnonymous;
    if (typeof body.allowMultiple === "boolean") data.allow_multiple = body.allowMultiple;

    let toRemove: string[] = [];
    let toEditLabel: { id: string; label: string }[] = [];
    let toAdd: string[] = [];

    if (Array.isArray(body.options)) {
      const voteCounts = await prisma.food_poll_votes.groupBy({
        by: ["option_id"],
        where: { poll_id: id },
        _count: { _all: true },
      });
      const voteCountByOption = new Map(voteCounts.map((v) => [v.option_id, v._count._all]));
      const existingOptions = poll.food_poll_options.map((o) => ({
        id: o.id,
        label: o.label,
        votes: voteCountByOption.get(o.id) ?? 0,
      }));

      const requested: RequestedPollOption[] = body.options
        .map((o: any) => ({
          id: typeof o?.id === "string" && !o.id.startsWith("n") ? o.id : undefined,
          label: String(o?.label ?? "").trim(),
        }))
        .filter((o: RequestedPollOption) => o.label);

      const validationError = validatePollOptionEdits(existingOptions, requested);
      if (validationError) {
        return apiError(validationError.message, validationError.code, 409);
      }

      toRemove = existingOptions.filter((e) => !requested.some((r) => r.id === e.id)).map((e) => e.id);
      toEditLabel = requested.filter((r): r is { id: string; label: string } => Boolean(r.id));
      toAdd = requested.filter((r) => !r.id).map((r) => r.label);
    }

    const updated = await prisma.$transaction(async (tx) => {
      await tx.food_polls.update({ where: { id }, data });

      if (toRemove.length) {
        await tx.food_poll_options.deleteMany({ where: { id: { in: toRemove } } });
      }
      for (const edit of toEditLabel) {
        await tx.food_poll_options.update({ where: { id: edit.id }, data: { label: edit.label } });
      }
      if (toAdd.length) {
        const maxPosition = poll.food_poll_options.reduce((max, o) => Math.max(max, o.position), -1);
        await tx.food_poll_options.createMany({
          data: toAdd.map((label, i) => ({ poll_id: id, label, position: maxPosition + 1 + i })),
        });
      }

      return tx.food_polls.findUnique({
        where: { id },
        include: { food_poll_options: { orderBy: { position: "asc" } } },
      });
    });

    return apiResponse(updated);
  } catch (error: any) {
    const msg = String(error?.message || "Failed to update poll");
    if (msg.startsWith("FORBIDDEN")) return apiError(msg.split(": ")[1] ?? msg, "FORBIDDEN", 403);
    return apiError(msg);
  }
}
