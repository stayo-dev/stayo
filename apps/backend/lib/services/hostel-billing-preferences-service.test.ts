/**
 * Hostel billing defaults regression matrix.
 * Run: node ./node_modules/.bin/tsx lib/services/hostel-billing-preferences-service.test.ts
 */

type OwnerId = "owner-a" | "owner-b";
type HostelId = "hostel-a" | "hostel-b" | "hostel-c";

type Hostel = {
  id: HostelId;
  owner_id: OwnerId;
  preferences_config: Record<string, any> | null;
};

type Room = {
  id: string;
  hostel_id: HostelId;
  room_no: string;
  base_rent: number;
};

type Tenant = {
  id: string;
  room_id: string;
  monthly_rent: number;
  advance_deposit: number;
  maintenance_charge: number;
  maintenance_type: string;
};

let passed = 0;
let failed = 0;
const failures: string[] = [];
let normalizeBillingDefaults: (rawConfig: unknown) => {
  advance_deposit: number;
  maintenance_charge: number;
  maintenance_type: string;
  auto_fill_room_rent: boolean;
  allow_override: boolean;
};

function assert(condition: boolean, name: string, detail = "") {
  if (condition) {
    console.log(`  OK ${name}`);
    passed++;
    return;
  }
  const message = `  FAIL ${name}${detail ? ` - ${detail}` : ""}`;
  console.error(message);
  failures.push(message);
  failed++;
}

function assertEq<T>(actual: T, expected: T, name: string) {
  assert(actual === expected, name, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function makeState() {
  return {
    hostels: [
      {
        id: "hostel-a",
        owner_id: "owner-a",
        preferences_config: {
          billing_defaults: {
            advance_deposit: 5000,
            maintenance_charge: 1000,
            maintenance_type: "MONTHLY",
            auto_fill_room_rent: true,
            allow_override: true,
          },
        },
      },
      {
        id: "hostel-b",
        owner_id: "owner-a",
        preferences_config: {
          billing_defaults: {
            advance_deposit: 15000,
            maintenance_charge: 2000,
            maintenance_type: "ONE_TIME",
            auto_fill_room_rent: true,
            allow_override: true,
          },
        },
      },
      {
        id: "hostel-c",
        owner_id: "owner-b",
        preferences_config: {
          billing_defaults: {
            advance_deposit: 9000,
            maintenance_charge: 0,
            maintenance_type: "NONE",
            auto_fill_room_rent: true,
            allow_override: true,
          },
        },
      },
    ] as Hostel[],
    rooms: [
      { id: "room-a", hostel_id: "hostel-a", room_no: "A1", base_rent: 8000 },
      { id: "room-b", hostel_id: "hostel-b", room_no: "B1", base_rent: 12000 },
      { id: "room-c", hostel_id: "hostel-c", room_no: "C1", base_rent: 7000 },
    ] as Room[],
    tenants: [] as Tenant[],
  };
}

function resolveInviteDefaults(state: ReturnType<typeof makeState>, roomId: string, ownerId: OwnerId) {
  const room = state.rooms.find((candidate) => candidate.id === roomId);
  const hostel = room ? state.hostels.find((candidate) => candidate.id === room.hostel_id) : null;
  if (!room || !hostel || hostel.owner_id !== ownerId) {
    throw new Error("FORBIDDEN: Room is not owned by the authenticated owner");
  }
  const defaults = normalizeBillingDefaults(hostel.preferences_config);
  return {
    room,
    billing_defaults: defaults,
    resolved_values: {
      monthly_rent: defaults.auto_fill_room_rent ? room.base_rent : 0,
      advance_deposit: defaults.advance_deposit,
      maintenance_charge: defaults.maintenance_type === "NONE" ? 0 : defaults.maintenance_charge,
      maintenance_type: defaults.maintenance_type,
    },
  };
}

function inviteTenant(
  state: ReturnType<typeof makeState>,
  roomId: string,
  ownerId: OwnerId,
  overrides: Partial<Tenant> = {}
) {
  const defaults = resolveInviteDefaults(state, roomId, ownerId).resolved_values;
  const tenant: Tenant = {
    id: `tenant-${state.tenants.length + 1}`,
    room_id: roomId,
    monthly_rent: overrides.monthly_rent ?? defaults.monthly_rent,
    advance_deposit: overrides.advance_deposit ?? defaults.advance_deposit,
    maintenance_charge: (overrides.maintenance_type ?? defaults.maintenance_type) === "NONE"
      ? 0
      : overrides.maintenance_charge ?? defaults.maintenance_charge,
    maintenance_type: overrides.maintenance_type ?? defaults.maintenance_type,
  };
  state.tenants.push(tenant);
  return tenant;
}

async function main() {
  process.env.SUPABASE_URL ||= "http://localhost";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-key";
  ({ normalizeBillingDefaults } = await import("./hostel-billing-preferences-service"));

  console.log("\nHostel billing defaults matrix");
  const state = makeState();

  const hostelA = resolveInviteDefaults(state, "room-a", "owner-a");
  assertEq(hostelA.resolved_values.monthly_rent, 8000, "Room base_rent auto-fills monthly rent");
  assertEq(hostelA.resolved_values.advance_deposit, 5000, "Hostel A advance defaults apply");
  assertEq(hostelA.resolved_values.maintenance_charge, 1000, "Hostel A maintenance defaults apply");

  const hostelB = resolveInviteDefaults(state, "room-b", "owner-a");
  assertEq(hostelB.resolved_values.advance_deposit, 15000, "Hostel B defaults isolated from Hostel A");
  assertEq(hostelB.resolved_values.maintenance_type, "ONE_TIME", "Hostel B maintenance type applies");

  const tenant = inviteTenant(state, "room-b", "owner-a", { monthly_rent: 13000, advance_deposit: 17000 });
  assertEq(tenant.monthly_rent, 13000, "Owner override for rent is preserved");
  assertEq(tenant.advance_deposit, 17000, "Owner override for advance is preserved");

  state.hostels[1].preferences_config = {
    billing_defaults: {
      advance_deposit: 22000,
      maintenance_charge: 2500,
      maintenance_type: "MONTHLY",
      auto_fill_room_rent: true,
      allow_override: true,
    },
  };
  assertEq(tenant.advance_deposit, 17000, "Existing tenant snapshot unaffected by preference update");

  assertEq(resolveInviteDefaults(state, "room-c", "owner-b").resolved_values.maintenance_charge, 0, "Maintenance NONE resolves to zero charge");
  assertEq(normalizeBillingDefaults({ advance_amount_default: 3000, maintenance_amount_default: 400 }).advance_deposit, 3000, "Legacy flat preferences fallback safely");

  try {
    resolveInviteDefaults(state, "room-c", "owner-a");
    assert(false, "Cross-owner room access rejected");
  } catch {
    assert(true, "Cross-owner room access rejected");
  }

  console.log(`\nHostel billing defaults: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.error(failures.join("\n"));
    process.exit(1);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });

export {};
