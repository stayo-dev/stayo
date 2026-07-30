# Dirty Operational Test Dataset - Real Hostel Chaos

**Purpose**: Test bulk import with realistic messy data  
**Source**: Patterns from real hostel Excel sheets

---

## Test Cases (Operational Chaos Scenarios)

### **1. Phone Number Chaos**
```
9876543210          ✅ Clean
+919876543210       ✅ Prefixed
91-9876543210       ⚠️ Hyphenated
(91) 9876543210     ⚠️ Parentheses
9876 543 210        ⚠️ Spaces
09876543210         ⚠️ Leading zero
919876543210        ⚠️ Missing +
987654321           ❌ 9 digits
98765432101         ❌ 11 digits
mobile              ❌ Text
(blank)             ❌ Empty
```

### **2. Name Chaos**
```
Rajesh Kumar                    ✅ Normal
RAJESH KUMAR                    ⚠️ All caps
rajesh kumar                    ⚠️ Lowercase
Rajesh  Kumar                   ⚠️ Double space
R.K.                            ⚠️ Initials only
Rajesh Kumar (brother)          ⚠️ Notes in name
रजेश कुमार                      ⚠️ Hindi characters
Rajesh123                       ⚠️ Numbers in name
R                               ❌ Single letter
(blank)                         ❌ Empty
```

### **3. Room Number Chaos**
```
101             ✅ Clean
101A            ✅ Alpha suffix
Room 101        ⚠️ Prefix text
R-101           ⚠️ Hyphenated
101 (ground)    ⚠️ Notes in room
1st floor 101   ⚠️ Floor prefix
ROOM101         ⚠️ No space
101/102         ❌ Multiple rooms
999             ❌ Non-existent
(blank)         ❌ Empty
```

### **4. Rent Chaos**
```
5000            ✅ Clean integer
5000.00         ✅ Decimal
₹5000           ⚠️ Currency symbol
5,000           ⚠️ Comma separator
5000/-          ⚠️ Rupee notation
Five thousand   ❌ Text
5000 per month  ⚠️ Extra text
-5000           ❌ Negative
0               ❌ Zero
(blank)         ❌ Empty
```

### **5. Date Chaos**
```
2026-05-01              ✅ ISO format
01/05/2026              ⚠️ DD/MM/YYYY
05/01/2026              ⚠️ MM/DD/YYYY (ambiguous)
1-5-2026                ⚠️ Single digits
01-May-2026             ⚠️ Month name
2026/05/01              ⚠️ Slashes
1st May 2026            ⚠️ Ordinal
today                   ❌ Relative
31/02/2026              ❌ Invalid date
(blank)                 ⚠️ Empty (use default)
```

### **6. Email Chaos**
```
john@example.com                ✅ Valid
JOHN@EXAMPLE.COM                ✅ Uppercase (normalize)
john.doe@example.com            ✅ Dot in name
john+tenant@example.com         ✅ Plus addressing
john@sub.example.com            ✅ Subdomain
johngmail.com                   ❌ Missing @
john@                           ❌ No domain
@example.com                    ❌ No username
john doe@example.com            ❌ Space
(blank)                         ⚠️ Empty (allow)
```

### **7. Password Chaos**
```
Pass123             ✅ Valid (6+ chars, letter+number)
pass123             ✅ Lowercase ok
PASS123             ✅ Uppercase ok
P@ss123!            ✅ Special chars ok
Pass12              ✅ Minimum 6
Pass1               ❌ Too short (5)
Password            ❌ No number
123456              ❌ No letter
     Pass123        ⚠️ Leading spaces
Pass123            ⚠️ Trailing spaces
(blank)             ❌ Empty
```

---

## Real-World Evil Scenarios

### **Scenario 1: Duplicate Invasion**
```csv
name,phone,room_no,monthly_rent,onboarding_password
Rajesh Kumar,9876543210,101,5000,pass123
Rajesh Kumar,9876543210,102,5500,pass456  ← Same phone!
Amit Shah,9876543211,101,5000,pass789     ← Same room!
```

**Expected**:
- Row 2: Duplicate phone detected
- Row 3: Room capacity validation (if room 101 full)

### **Scenario 2: Format Mayhem**
```csv
name,phone,room_no,monthly_rent,onboarding_password
VIJAY,91-9876543210,R-101,₹5000,pass123
vijay kumar, 9876 543 210 ,101,5,000,PASS123
Priya  Sharma,+919876543212,Room 101,Five thousand,pass@123
```

**Expected**:
- Row 1: Normalize phone, room, rent
- Row 2: Lowercase name, parse phone, parse rent
- Row 3: Fail on rent (text), warn on room format

### **Scenario 3: Empty Row Chaos**
```csv
name,phone,room_no,monthly_rent,onboarding_password
Rajesh,9876543210,101,5000,pass123
,,,,,                                    ← Empty row
Amit,9876543211,102,5500,pass456
```

**Expected**:
- Row 2: Skip empty row entirely (don't count as error)

### **Scenario 4: Partial Data**
```csv
name,phone,room_no,monthly_rent,onboarding_password
Rajesh Kumar,9876543210,101,5000,pass123
Amit Shah,9876543211,,5500,pass456           ← Missing room
Priya Sharma,,102,5000,pass789               ← Missing phone
Vijay Kumar,9876543213,103,,pass000          ← Missing rent
```

**Expected**:
- Row 1: Success
- Row 2: Error (room required)
- Row 3: Error (phone required)
- Row 4: Error (rent required)

### **Scenario 5: Unicode Nightmare**
```csv
name,phone,room_no,monthly_rent,onboarding_password
राजेश कुमार,9876543210,101,5000,pass123       ← Hindi name
Müller,9876543211,102,5500,pass456            ← German umlaut
José García,9876543212,103,5000,pass789       ← Spanish accents
李明,9876543213,104,5500,pass000               ← Chinese characters
```

**Expected**:
- All should work (UTF-8 support)
- Names stored as-is
- Phone parsing unaffected

### **Scenario 6: Excel Formula Injection**
```csv
name,phone,room_no,monthly_rent,onboarding_password
=1+1,9876543210,101,5000,pass123              ← Excel formula
@SUM(A1:A10),9876543211,102,5500,pass456      ← Formula
+CMD|'/c calc',9876543212,103,5000,pass789    ← Command injection
```

**Expected**:
- Formulas treated as text strings
- No execution
- Validation may fail on name format

### **Scenario 7: The Midnight Import**
```csv
name,phone,room_no,monthly_rent,onboarding_password,joining_date
Rajesh,9876543210,101,5000,pass123,2026-12-31
Amit,9876543211,101,5500,pass456,2026-12-31    ← Same room, same date!
Priya,9876543212,102,5000,pass789,2025-01-01  ← Past date
```

**Expected**:
- Row 1: Success
- Row 2: Capacity conflict (room 101 full on 2026-12-31)
- Row 3: Past date warning (but allow)

---

## Import Recovery Scenarios

### **Scenario R1: Partial Success**
```
Import batch: 10 tenants
↓
Tenants 1-5: SUCCESS
Tenant 6: FAIL (duplicate phone)
Tenants 7-10: Not processed (stopped)
```

**Test**:
- Can owner retry rows 6-10 only?
- Are rows 1-5 idempotent (skip if re-imported)?

### **Scenario R2: Mid-Import Crash**
```
Import batch: 50 tenants
↓
Processing tenant 23...
↓
DATABASE CONNECTION LOST
↓
Server restart
```

**Test**:
- Batch status = IMPORTING (stuck)
- Can system detect and recover?
- Can owner safely retry entire batch?

### **Scenario R3: Concurrent Imports**
```
Owner 1: Importing 50 tenants to Hostel A
Owner 2: Importing 30 tenants to Hostel A (same hostel!)
↓
Room 101 assigned in both imports
```

**Test**:
- Transaction isolation prevents double-assignment?
- Capacity checks don't race?

---

## Observability Test Cases

### **Question 1: Import Failed - Why?**
Owner sees: "Import failed. 5/10 tenants imported."

**Required Information**:
```json
{
  "batch_id": "abc123",
  "status": "COMPLETED",
  "summary": {
    "total": 10,
    "success": 5,
    "failed": 5
  },
  "failures": [
    {"row": 2, "error": "Phone +919876543210 already exists"},
    {"row": 4, "error": "Room 101 is full (2/2 capacity)"},
    {"row": 6, "error": "Password too weak (min 6 chars)"},
    {"row": 8, "error": "Invalid email format"},
    {"row": 10, "error": "Room 999 does not exist"}
  ]
}
```

### **Question 2: Tenant Can't Login - Why?**
Tenant: "I'm using the password from the form but it says invalid."

**Debug Checklist**:
- [ ] Check profile.is_imported = true
- [ ] Check profile.password_reset_required = true
- [ ] Check profile.onboarding_expires_at > NOW()
- [ ] Check tenant.status = ACTIVE
- [ ] Check login_attempts for failed attempts
- [ ] Check phone number format matches (+91XXXXXXXXXX)

### **Question 3: Import Stuck - What Happened?**
Batch status = "IMPORTING" for 2 hours.

**Debug**:
```sql
SELECT * FROM bulk_import_batches 
WHERE status = 'IMPORTING' 
AND created_at < NOW() - INTERVAL '1 hour';

-- Check for orphaned imports
-- Manual recovery: UPDATE status = 'FAILED' where stuck
```

---

## Load Test Scenarios

### **Test L1: 50 Tenants**
- File size: ~50 KB
- Expected duration: <5 seconds
- Memory usage: <10 MB
- Success rate: >95%

### **Test L2: 100 Tenants**
- File size: ~100 KB
- Expected duration: <10 seconds
- Memory usage: <20 MB
- Success rate: >90%

### **Test L3: 500 Tenants** 🔴 **CRITICAL**
- File size: ~500 KB
- Expected duration: <60 seconds
- Memory usage: <50 MB
- Success rate: >85%

**If this fails**: Implement chunking or async processing

---

## CSV Test Files to Create

1. **`clean-50-tenants.xlsx`** - Happy path
2. **`dirty-phones.xlsx`** - Phone number chaos
3. **`duplicate-hell.xlsx`** - Duplicates everywhere
4. **`partial-data.xlsx`** - Missing required fields
5. **`unicode-names.xlsx`** - International characters
6. **`room-conflicts.xlsx`** - Same room multiple times
7. **`date-formats.xlsx`** - Every date format imaginable
8. **`empty-rows.xlsx`** - Blank rows scattered
9. **`500-tenants.xlsx`** - Load test dataset
10. **`malicious.xlsx`** - Formula injection attempts

---

**This is how you test operational software. Not clean demos.**
