type HostelScopedEntity = {
  id?: string | null;
  hostel_id?: string | null;
};

function financialScopeError(code: string, message: string) {
  const err: any = new Error(`${code}: ${message}`);
  err.code = code;
  return err;
}

export function requireFinancialHostelId(hostelId: string | null | undefined, label = "financial operation"): string {
  if (!hostelId) {
    throw financialScopeError("HOSTEL_CONTEXT_REQUIRED", `${label} requires explicit hostelId`);
  }
  return hostelId;
}

export function assertFinancialHostelMatch(
  label: string,
  actualHostelId: string | null | undefined,
  expectedHostelId: string | null | undefined,
) {
  const expected = requireFinancialHostelId(expectedHostelId, label);
  if (!actualHostelId) {
    throw financialScopeError("HOSTEL_CONTEXT_REQUIRED", `${label} is missing immutable hostel_id`);
  }
  if (actualHostelId !== expected) {
    throw financialScopeError(
      "HOSTEL_CONTEXT_MISMATCH",
      `${label} hostel_id mismatch: expected ${expected}, got ${actualHostelId}`,
    );
  }
}

export function assertScopedEntityHostel(
  label: string,
  entity: HostelScopedEntity | null | undefined,
  expectedHostelId: string,
) {
  if (!entity) {
    throw financialScopeError("NOT_FOUND", `${label} not found`);
  }
  assertFinancialHostelMatch(label, entity.hostel_id, expectedHostelId);
}

export function assertSameFinancialHostel(
  childLabel: string,
  child: HostelScopedEntity | null | undefined,
  parentLabel: string,
  parent: HostelScopedEntity | null | undefined,
) {
  if (!parent) {
    throw financialScopeError("NOT_FOUND", `${parentLabel} not found`);
  }
  const parentHostelId = requireFinancialHostelId(parent.hostel_id, parentLabel);
  assertScopedEntityHostel(childLabel, child, parentHostelId);
}
