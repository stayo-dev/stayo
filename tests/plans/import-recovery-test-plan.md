# Import Recovery Test Plan - Production Critical

**Priority**: 🔴 **BLOCKING PRODUCTION**  
**Test Question**: "Can the system safely recover from interrupted imports without duplicates or corrupted allocations?"  
**Success Criteria**: 100% idempotent recovery with zero data corruption

---

## Critical Test: Mid-Import Crash Recovery

### **Scenario R1: Database Disconnect During Import**

**Setup**:
```
- 50 tenants in import file
- Import starts successfully
- Processing tenant 23 of 50
- Database connection lost (simulate with timeout)
```

**Expected State After Crash**:
```sql
-- Check batch status
SELECT id, status, total_rows, imported_rows, failed_rows
FROM bulk_import_batches 
WHERE id = '{batch_id}';

-- Expected: status = 'IMPORTING' (stuck)
-- Expected: imported_rows = 22 (last successful commit)
```

**Recovery Test Steps**:

1. **Detect Stuck Import**
```sql
-- Find imports stuck for >5 minutes
SELECT * FROM bulk_import_batches
WHERE status = 'IMPORTING' 
AND uploaded_at < NOW() - INTERVAL '5 minutes';
```

2. **Verify Partial State**
```sql
-- Count tenants created before crash
SELECT COUNT(*) FROM tenants
WHERE owner_id = '{owner_id}'
AND created_at > (
  SELECT uploaded_at FROM bulk_import_batches WHERE id = '{batch_id}'
);

-- Expected: 22 tenants (rows 1-22)
```

3. **Check Room Allocations Integrity**
```sql
-- Verify all created tenants have allocations
SELECT t.id, t.profile_id, ra.id as allocation_id
FROM tenants t
LEFT JOIN room_allocations ra ON ra.tenant_id = t.id
WHERE t.owner_id = '{owner_id}'
AND t.created_at > (
  SELECT uploaded_at FROM bulk_import_batches WHERE id = '{batch_id}'
);

-- Expected: 22 rows, ALL have allocation_id (no NULLs)
```

4. **Check Financial Integrity**
```sql
-- Verify all tenants have initial obligations
SELECT t.id, COUNT(ro.id) as obligation_count
FROM tenants t
LEFT JOIN rent_obligations ro ON ro.tenant_id = t.id
WHERE t.owner_id = '{owner_id}'
AND t.created_at > (
  SELECT uploaded_at FROM bulk_import_batches WHERE id = '{batch_id}'
)
GROUP BY t.id;

-- Expected: 22 rows, ALL have obligation_count >= 1
```

5. **Attempt Retry**
```
Owner action: Re-upload same XLSX file
System: Validate → Preview
```

**Critical Validation: Duplicate Detection**
```typescript
// In validation service
const existingPhones = await prisma.profile.findMany({
  where: {
    phone: { in: allPhonesFromFile },
    owner_id: ownerId
  },
  select: { phone: true }
});

// Expected: 22 phones already exist (rows 1-22)
// Expected: Validation marks rows 1-22 as DUPLICATE
// Expected: Rows 23-50 marked as VALID
```

**Retry Import**:
```
Owner confirms import of remaining rows
System processes rows 23-50 only
```

**Post-Retry Verification**:
```sql
-- Final count should be 50 tenants
SELECT COUNT(*) FROM tenants
WHERE owner_id = '{owner_id}'
AND created_at > '{test_start_time}';

-- Expected: 50

-- No duplicates
SELECT phone, COUNT(*) as count
FROM profiles
WHERE owner_id = '{owner_id}'
AND created_at > '{test_start_time}'
GROUP BY phone
HAVING COUNT(*) > 1;

-- Expected: 0 rows (no duplicates)

-- All allocations valid
SELECT COUNT(*) FROM room_allocations ra
JOIN tenants t ON t.id = ra.tenant_id
WHERE t.owner_id = '{owner_id}'
AND ra.created_at > '{test_start_time}'
AND ra.is_active = true;

-- Expected: 50 (one allocation per tenant)

-- All obligations created
SELECT tenant_id, COUNT(*) as obligation_count
FROM rent_obligations
WHERE tenant_id IN (
  SELECT id FROM tenants WHERE owner_id = '{owner_id}'
  AND created_at > '{test_start_time}'
)
GROUP BY tenant_id;

-- Expected: 50 rows, all with obligation_count >= 1
```

**Success Criteria**:
- ✅ Partial import state preserved (22 tenants)
- ✅ No data corruption (all 22 have allocations + obligations)
- ✅ Duplicate detection works (rows 1-22 skipped on retry)
- ✅ Remaining rows import successfully (23-50)
- ✅ Final state: 50 tenants, no duplicates, all valid
- ✅ Room capacity not exceeded

---

## Scenario R2: Transaction Rollback Test

**Setup**:
```
- Import batch with 10 tenants
- Row 6 has invalid room number (doesn't exist)
- Atomic transaction should rollback
```

**Expected Behavior**:
```typescript
// In tenant-migration-service.ts
await prisma.$transaction(async (tx) => {
  // Create profile
  const profile = await tx.profile.create(...);
  
  // Create tenant
  const tenant = await tx.tenant.create(...);
  
  // Create allocation - FAILS HERE (room not found)
  const allocation = await tx.roomAllocation.create({
    room_id: nonExistentRoom // ERROR!
  });
  
  // Transaction automatically rolls back
});
```

**Verification**:
```sql
-- Tenant 5 should exist (before failure)
SELECT * FROM tenants WHERE /* matches row 5 */;
-- Expected: 1 row

-- Tenant 6 should NOT exist (transaction rolled back)
SELECT * FROM tenants WHERE /* matches row 6 */;
-- Expected: 0 rows

-- No orphaned profiles
SELECT p.* FROM profiles p
LEFT JOIN tenants t ON t.profile_id = p.id
WHERE p.owner_id = '{owner_id}'
AND p.created_at > '{test_start_time}'
AND t.id IS NULL;
-- Expected: 0 rows (no orphans)
```

**Success Criteria**:
- ✅ Rows 1-5 imported successfully
- ✅ Row 6 failed atomically (no partial state)
- ✅ Rows 7-10 not processed (stopped at first failure)
- ✅ No orphaned profiles or allocations
- ✅ Error clearly reported to owner

---

## Scenario R3: Concurrent Import Collision

**Setup**:
```
Owner 1: Importing 30 tenants to Hostel A
Owner 2: Importing 20 tenants to Hostel A (SAME HOSTEL!)
Both imports happen simultaneously
Room 101 assigned in both files
```

**Test Execution**:
```bash
# Terminal 1
curl -X POST /api/bulk-import/{batch1}/confirm

# Terminal 2 (simultaneously)
curl -X POST /api/bulk-import/{batch2}/confirm
```

**Critical Race Condition Test**:
```typescript
// In tenant-migration-service.ts
await tx.$executeRaw`
  SELECT id FROM rooms WHERE id = ${roomId} FOR UPDATE
`;

// Then check capacity
const currentOccupancy = await tx.roomAllocation.count({
  where: { room_id: roomId, is_active: true }
});

if (currentOccupancy >= room.capacity) {
  throw new Error('Room capacity exceeded');
}
```

**Verification**:
```sql
-- Check room 101 allocation count
SELECT COUNT(*) FROM room_allocations
WHERE room_id = (SELECT id FROM rooms WHERE room_no = '101' AND hostel_id = '{hostelId}')
AND is_active = true;

-- Expected: <= room capacity (e.g., 2 if capacity is 2)

-- Check both batches
SELECT id, status, imported_rows, failed_rows
FROM bulk_import_batches
WHERE id IN ('{batch1}', '{batch2}');

-- Expected: 
-- One batch: status = 'COMPLETED', imported_rows > 0
-- Other batch: status = 'COMPLETED' or 'FAILED', some rows failed due to capacity
```

**Success Criteria**:
- ✅ No room over-capacity (strict <= capacity enforcement)
- ✅ Transaction isolation prevents race condition
- ✅ One import wins, other gets clear error
- ✅ Failed rows clearly identified
- ✅ No corrupted allocations

---

## Scenario R4: Idempotency Test

**Setup**:
```
- Import 50 tenants successfully
- Wait 5 minutes
- Re-upload EXACT SAME FILE
```

**Expected Behavior**:
```
Upload → Validation detects all 50 phones already exist
Preview shows: 
- 0 valid rows
- 50 duplicate rows
- Clear message: "All tenants already imported"
```

**Verification**:
```sql
-- Total tenant count unchanged
SELECT COUNT(*) FROM tenants WHERE owner_id = '{owner_id}';
-- Expected: 50 (not 100)

-- No duplicate phones
SELECT phone, COUNT(*) FROM profiles
WHERE owner_id = '{owner_id}'
GROUP BY phone
HAVING COUNT(*) > 1;
-- Expected: 0 rows
```

**Success Criteria**:
- ✅ All rows detected as duplicates
- ✅ No tenants created
- ✅ Clear user message
- ✅ Batch status = 'VALIDATED' (not imported)

---

## Scenario R5: Partial Overlap Retry

**Setup**:
```
- First import: 50 tenants (successful)
- Second import: 70 tenants
  - Rows 1-50: Same as first import (duplicates)
  - Rows 51-70: New tenants
```

**Expected Behavior**:
```
Validation results:
- 50 duplicate rows (skip)
- 20 valid rows (import)

Owner confirms → System imports only rows 51-70
```

**Verification**:
```sql
-- Final count: 70 tenants
SELECT COUNT(*) FROM tenants WHERE owner_id = '{owner_id}';
-- Expected: 70

-- No duplicate allocations
SELECT room_id, COUNT(*) 
FROM room_allocations ra
JOIN tenants t ON t.id = ra.tenant_id
WHERE t.owner_id = '{owner_id}'
AND ra.is_active = true
GROUP BY room_id;
-- Expected: All counts <= room capacity
```

**Success Criteria**:
- ✅ Rows 1-50 skipped (duplicates)
- ✅ Rows 51-70 imported successfully
- ✅ Total: 70 unique tenants
- ✅ No duplicate phones or allocations

---

## Test Automation Script

```typescript
// test-import-recovery.ts

import { PrismaClient } from '@prisma/client';
import { BulkImportValidationService } from '../lib/services/bulk-import-validation-service';
import { TenantMigrationService } from '../lib/services/tenant-migration-service';

const prisma = new PrismaClient();

async function testMidImportCrashRecovery() {
  console.log('🧪 Testing: Mid-import crash recovery');
  
  const ownerId = 'test-owner-uuid';
  const hostelId = 'test-hostel-uuid';
  
  // Step 1: Start import
  const batchId = await startImport(ownerId, hostelId, 50);
  
  // Step 2: Process 22 tenants then simulate crash
  await processPartialImport(batchId, 22);
  
  // Step 3: Verify partial state
  const partialCount = await prisma.tenant.count({
    where: { 
      owner_id: ownerId,
      import_batch_id: batchId 
    }
  });
  
  console.assert(partialCount === 22, `Expected 22 tenants, got ${partialCount}`);
  
  // Step 4: Verify all have allocations
  const tenantsWithoutAllocations = await prisma.tenant.findMany({
    where: { 
      owner_id: ownerId,
      import_batch_id: batchId,
      room_allocations: { none: {} }
    }
  });
  
  console.assert(
    tenantsWithoutAllocations.length === 0,
    `Found ${tenantsWithoutAllocations.length} orphaned tenants!`
  );
  
  // Step 5: Retry import
  const retryResult = await retryImport(batchId);
  
  // Step 6: Verify final state
  const finalCount = await prisma.tenant.count({
    where: { owner_id: ownerId }
  });
  
  console.assert(finalCount === 50, `Expected 50 tenants, got ${finalCount}`);
  
  // Step 7: Verify no duplicates
  const duplicatePhones = await prisma.profile.groupBy({
    by: ['phone'],
    where: { owner_id: ownerId },
    having: { phone: { _count: { gt: 1 } } }
  });
  
  console.assert(
    duplicatePhones.length === 0,
    `Found ${duplicatePhones.length} duplicate phones!`
  );
  
  console.log('✅ Mid-import crash recovery: PASSED');
}

async function testConcurrentImportCollision() {
  console.log('🧪 Testing: Concurrent import collision');
  
  const ownerId = 'test-owner-uuid';
  const hostelId = 'test-hostel-uuid';
  
  // Create room with capacity 2
  const room = await prisma.room.create({
    data: {
      room_no: '101',
      hostel_id: hostelId,
      capacity: 2,
      floor_no: 1
    }
  });
  
  // Start two imports simultaneously
  const [result1, result2] = await Promise.allSettled([
    importTenants(ownerId, hostelId, [
      { room_no: '101', phone: '9876543210', /* ... */ },
      { room_no: '101', phone: '9876543211', /* ... */ },
    ]),
    importTenants(ownerId, hostelId, [
      { room_no: '101', phone: '9876543212', /* ... */ },
      { room_no: '101', phone: '9876543213', /* ... */ },
    ])
  ]);
  
  // Check room capacity not exceeded
  const allocations = await prisma.roomAllocation.count({
    where: { 
      room_id: room.id,
      is_active: true 
    }
  });
  
  console.assert(
    allocations <= 2,
    `Room capacity exceeded! Expected <= 2, got ${allocations}`
  );
  
  console.log('✅ Concurrent import collision: PASSED');
}

async function testIdempotency() {
  console.log('🧪 Testing: Idempotent import');
  
  const ownerId = 'test-owner-uuid';
  const hostelId = 'test-hostel-uuid';
  
  // Import 50 tenants
  await importTenants(ownerId, hostelId, generateTestData(50));
  
  const countAfterFirst = await prisma.tenant.count({
    where: { owner_id: ownerId }
  });
  
  // Re-import same data
  const retryResult = await importTenants(ownerId, hostelId, generateTestData(50));
  
  const countAfterRetry = await prisma.tenant.count({
    where: { owner_id: ownerId }
  });
  
  console.assert(
    countAfterFirst === countAfterRetry,
    `Expected ${countAfterFirst}, got ${countAfterRetry} (not idempotent!)`
  );
  
  console.log('✅ Idempotent import: PASSED');
}

// Run all tests
async function runRecoveryTests() {
  try {
    await testMidImportCrashRecovery();
    await testConcurrentImportCollision();
    await testIdempotency();
    
    console.log('\n🎉 All recovery tests PASSED');
  } catch (error) {
    console.error('\n❌ Recovery tests FAILED:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runRecoveryTests();
```

---

## Manual Test Checklist

### **Pre-Test Setup**
- [ ] Staging database with clean state
- [ ] Test owner account created
- [ ] Test hostel created with rooms
- [ ] 50-tenant test file prepared
- [ ] 500-tenant test file prepared

### **Recovery Tests**
- [ ] **R1**: Mid-import crash (simulate at row 23/50)
- [ ] **R2**: Transaction rollback (invalid room)
- [ ] **R3**: Concurrent imports (same hostel)
- [ ] **R4**: Idempotency (re-import same file)
- [ ] **R5**: Partial overlap (50 old + 20 new)

### **Verification Checks**
- [ ] No orphaned profiles (profile without tenant)
- [ ] No orphaned allocations (allocation without tenant)
- [ ] No orphaned obligations (obligation without tenant)
- [ ] No duplicate phones in system
- [ ] Room capacity never exceeded
- [ ] Batch status accurate (IMPORTING vs COMPLETED vs FAILED)

### **Edge Cases**
- [ ] Empty XLSX file
- [ ] Single row file
- [ ] All rows invalid
- [ ] All rows duplicates
- [ ] Mixed valid/invalid/duplicate

---

## Success Criteria Summary

**The system PASSES recovery testing if**:

1. ✅ **Atomic Transactions**: Failure at row N leaves rows 1-(N-1) valid, no partial state at row N
2. ✅ **Idempotent Retries**: Re-importing same data creates no duplicates
3. ✅ **Crash Recovery**: Interrupted imports can be safely resumed
4. ✅ **Conflict Prevention**: Concurrent imports don't violate room capacity
5. ✅ **Data Integrity**: No orphaned records (profiles, allocations, obligations always linked)
6. ✅ **Clear Errors**: Failed rows clearly identified with actionable messages

**If ANY of these fail**: System is NOT production-ready.

---

## Next Steps After Passing

1. Document recovery procedures in runbook
2. Add automatic stuck-import detection (cron job)
3. Create owner-facing retry UI
4. Add batch recovery API endpoint
5. Monitor recovery success rate in production

---

**Current Status**: Test plan complete, awaiting execution  
**Blocker**: Must pass all recovery tests before staging deployment  
**Critical Test**: Mid-import crash recovery (R1) is most important
