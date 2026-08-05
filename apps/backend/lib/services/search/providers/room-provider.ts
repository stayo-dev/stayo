import { prisma } from "../../../db";
import { scoreField, sortByScore } from "../ranking";
import type { SearchProvider, SearchResult } from "../types";

/**
 * Room search.
 *
 * Owner scoping goes through the room's hostel (`hostels.owner_id`) — rooms
 * carry no `owner_id` of their own, so filtering on the relation is the only
 * correct way to keep one owner out of another's rooms.
 *
 * Occupancy is counted from active allocations rather than read off any
 * cached field, because the vacancy number is the whole reason an owner
 * searches a room, and a stale one would send them to fill a bed that isn't free.
 */
export const roomProvider: SearchProvider = {
  type: "ROOM",
  label: "Rooms",
  order: 3,

  async search({ ownerId, query, limit }) {
    const q = query.trim();
    if (!q) return [];

    const rooms = await prisma.rooms.findMany({
      where: {
        is_active: true,
        hostels: { owner_id: ownerId, status: { in: ["ACTIVE", "INACTIVE"] } },
        room_no: { contains: q, mode: "insensitive" },
      },
      select: {
        id: true,
        room_no: true,
        capacity: true,
        hostel_id: true,
        hostels: { select: { name: true } },
        _count: { select: { room_allocations: { where: { is_active: true, end_date: null } } } },
      },
      take: Math.max(limit * 3, 30),
    });

    const results: SearchResult[] = rooms.map((r: any) => {
      const capacity = Number(r.capacity ?? 0);
      const occupied = Number(r._count?.room_allocations ?? 0);
      const vacant = Math.max(capacity - occupied, 0);

      return {
        type: "ROOM" as const,
        id: r.id,
        title: `Room ${r.room_no}`,
        subtitle: [r.hostels?.name, `${occupied}/${capacity} beds`].filter(Boolean).join(" · "),
        meta: vacant > 0 ? `${vacant} bed${vacant > 1 ? "s" : ""} free` : "Full",
        metaTone: vacant > 0 ? ("success" as const) : ("neutral" as const),
        // Deep-links the rooms screen straight to this room's sheet, so the
        // owner lands on the room itself rather than a list to hunt through.
        href: `/owner/hostels/${r.hostel_id}/rooms?room=${r.id}`,
        score: scoreField(q, r.room_no, "room"),
        data: { hostelId: r.hostel_id, vacant, capacity, occupied },
      };
    });

    return sortByScore(results.filter((r) => r.score > 0)).slice(0, limit);
  },
};
