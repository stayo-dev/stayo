import { prisma } from "@/lib/db";
import { eventLog } from "@/lib/services/event-log-service";
import {
  fullName, validateBio, validateDisplayName, validateHostingSince, validateLanguages, type RuleResult,
} from "./bio-rules";
import { loadHostStats, type HostStats } from "./host-stats";

/**
 * Meet your host (ADR-200) — the owner as residents meet them on a listing.
 *
 * Composes three sources rather than copying any of them: the account name
 * (`profiles.name`), the photo (`profile_identity.photo_url`), and the owner's
 * own words (`owner_host_profiles`), plus stats counted live in `host-stats`.
 *
 * Moderation is live-on-save with an admin override: an owner's edit is
 * public immediately; an admin can edit it or hide the bio/photo, and a hide
 * survives later owner edits until an admin lifts it.
 */

export class HostProfileError extends Error {
  constructor(public code: string, public status: number, message: string) {
    super(message);
    this.name = "HostProfileError";
  }
}

export interface PublicHost {
  name: string | null;
  photo_url: string | null;
  bio: string | null;
  languages: string[];
  hosting_since: number | null;
  verified: boolean;
  /** When the owner joined Stayo — `profiles.created_at`. */
  listed_since: string | null;
  stats: HostStats;
}

export interface EditableHost extends PublicHost {
  bio_hidden: boolean;
  photo_hidden: boolean;
}

export interface AdminHost extends EditableHost {
  updated_at: string | null;
  updated_by_name: string | null;
}

export { fullName };

const HOST_SELECT = {
  bio: true, languages: true, hosting_since: true, bio_hidden: true, photo_hidden: true, updated_at: true, updated_by: true,
} as const;

function isMissingTable(error: unknown): boolean {
  const e = error as { code?: string; message?: string } | null;
  return e?.code === "P2021" || /owner_host_profiles.*does not exist/i.test(String(e?.message ?? ""));
}

const iso = (value: unknown) => (value ? new Date(value as string).toISOString() : null);

function pickHostFields(body: Record<string, unknown>, now: Date, partial: boolean) {
  const data: Record<string, unknown> = {};
  const take = <T,>(key: string, result: RuleResult<T>) => {
    if (!result.ok) throw new HostProfileError("VALIDATION_ERROR", 400, result.reason);
    data[key] = result.value;
  };
  if (!partial || "bio" in body) take("bio", validateBio(body.bio));
  if (!partial || "languages" in body) take("languages", validateLanguages(body.languages));
  if (!partial || "hosting_since" in body) take("hosting_since", validateHostingSince(body.hosting_since, now));
  return data;
}

type Log = { log: (eventType: string, ownerId?: string | null, metadata?: Record<string, any>) => Promise<void> };

export function createHostProfileService({ db, log = eventLog, now = () => new Date() }: { db: any; log?: Log; now?: () => Date }) {
  async function readHostRow(ownerId: string) {
    try {
      return await db.owner_host_profile.findUnique({ where: { profile_id: ownerId }, select: HOST_SELECT });
    } catch (error) {
      // Migration 083 not applied yet: an owner with no words, not an outage.
      if (isMissingTable(error)) return null;
      throw error;
    }
  }

  async function upsertRow(ownerId: string, data: Record<string, unknown>) {
    const stamped = { ...data, updated_at: now() };
    try {
      await db.owner_host_profile.upsert({
        where: { profile_id: ownerId },
        create: { profile_id: ownerId, ...stamped },
        update: stamped,
        select: { profile_id: true },
      });
    } catch (error) {
      if (isMissingTable(error)) {
        throw new HostProfileError("HOST_PROFILE_UNAVAILABLE", 503, "Host profiles aren't available yet. Please try again later.");
      }
      throw error;
    }
  }

  async function requireOwner(ownerId: string) {
    const profile = await db.profile.findFirst({
      where: { id: ownerId, role: "OWNER" },
      select: { id: true, name: true, created_at: true },
    });
    if (!profile) throw new HostProfileError("NOT_FOUND", 404, "Owner not found");
    return profile;
  }

  async function load(ownerId: string) {
    const profile = await requireOwner(ownerId);
    const [identity, row, stats] = await Promise.all([
      db.profile_identity.findUnique({ where: { profile_id: ownerId }, select: { photo_url: true } }),
      readHostRow(ownerId),
      loadHostStats(db, ownerId),
    ]);
    const { verified, ...counts } = stats;
    const host: EditableHost = {
      name: fullName(profile.name),
      photo_url: identity?.photo_url ?? null,
      bio: row?.bio ?? null,
      languages: row?.languages ?? [],
      hosting_since: row?.hosting_since ?? null,
      verified,
      listed_since: iso(profile.created_at),
      stats: counts,
      bio_hidden: Boolean(row?.bio_hidden),
      photo_hidden: Boolean(row?.photo_hidden),
    };
    return { host, row };
  }

  async function getForOwner(ownerId: string): Promise<EditableHost> {
    return (await load(ownerId)).host;
  }

  async function getForAdmin(ownerId: string): Promise<AdminHost> {
    const { host, row } = await load(ownerId);
    const updater = row?.updated_by
      ? await db.profile.findUnique({ where: { id: row.updated_by }, select: { name: true } })
      : null;
    return { ...host, updated_at: iso(row?.updated_at), updated_by_name: fullName(updater?.name) };
  }

  return {
    /** What a stranger sees. Hidden fields are dropped here, never in the client. */
    async getPublicHost(ownerId: string): Promise<PublicHost> {
      const { bio_hidden, photo_hidden, ...host } = (await load(ownerId)).host;
      return { ...host, bio: bio_hidden ? null : host.bio, photo_url: photo_hidden ? null : host.photo_url };
    },

    /** The owner sees their own words even while Stayo has hidden them. */
    getForOwner,
    getForAdmin,

    /** Replaces the owner's three fields. The hide flags are not theirs to set. */
    async updateByOwner(ownerId: string, body: Record<string, unknown>): Promise<EditableHost> {
      await requireOwner(ownerId);
      const data = pickHostFields(body ?? {}, now(), false);
      await upsertRow(ownerId, { ...data, updated_by: ownerId });
      return getForOwner(ownerId);
    },

    /** Edits only the keys sent. Same bio rules as the owner — they protect the platform. */
    async updateByAdmin(ownerId: string, adminId: string, patch: Record<string, unknown>): Promise<AdminHost> {
      await requireOwner(ownerId);
      const body = patch ?? {};
      const hostData = pickHostFields(body, now(), true);
      for (const flag of ["bio_hidden", "photo_hidden"] as const) {
        if (!(flag in body)) continue;
        if (typeof body[flag] !== "boolean") throw new HostProfileError("VALIDATION_ERROR", 400, `${flag} must be true or false.`);
        hostData[flag] = body[flag];
      }

      let name: string | undefined;
      if ("name" in body) {
        const result = validateDisplayName(body.name);
        if (!result.ok) throw new HostProfileError("VALIDATION_ERROR", 400, result.reason);
        name = result.value;
      }

      const fields = [...Object.keys(hostData), ...(name !== undefined ? ["name"] : [])];
      if (fields.length === 0) throw new HostProfileError("VALIDATION_ERROR", 400, "Nothing to update.");

      // Host row first: if migration 083 is missing this fails before the
      // account name changes, so an admin never gets half an edit.
      if (Object.keys(hostData).length > 0) await upsertRow(ownerId, { ...hostData, updated_by: adminId });
      if (name !== undefined) {
        await db.profile.update({ where: { id: ownerId }, data: { name, updated_at: now() }, select: { id: true } });
      }

      await log.log("OWNER_HOST_PROFILE_ADMIN_EDIT", ownerId, { fields, admin_id: adminId });
      return getForAdmin(ownerId);
    },
  };
}

export const hostProfileService = createHostProfileService({ db: prisma });
