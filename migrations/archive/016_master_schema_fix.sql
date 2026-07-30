-- Migration 016: Master Schema Fix
-- This migration addresses all inconsistencies identified during debugging.

-- 1. Fix Payments Table
DO $$ 
BEGIN
    -- Add owner_id to payments
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='payments' AND column_name='owner_id') THEN
        ALTER TABLE payments ADD COLUMN owner_id UUID REFERENCES profiles(id);
    END IF;
    
    -- Ensure obligation_id exists (it should based on previous migrations, but let's be safe)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='payments' AND column_name='obligation_id') THEN
        -- This is a breaking change if we don't have it, but it's required by backend
        ALTER TABLE payments ADD COLUMN obligation_id UUID REFERENCES rent_obligations(id) ON DELETE CASCADE;
    END IF;
END $$;

-- 2. Fix Complaints Table
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='complaints' AND column_name='resolved_at') THEN
        ALTER TABLE complaints ADD COLUMN resolved_at TIMESTAMPTZ;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='complaints' AND column_name='staff_remarks') THEN
        ALTER TABLE complaints ADD COLUMN staff_remarks TEXT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='complaints' AND column_name='updated_by') THEN
        ALTER TABLE complaints ADD COLUMN updated_by UUID REFERENCES profiles(id);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='complaints' AND column_name='category') THEN
        ALTER TABLE complaints ADD COLUMN category TEXT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='complaints' AND column_name='priority') THEN
        ALTER TABLE complaints ADD COLUMN priority TEXT DEFAULT 'MEDIUM';
    END IF;
END $$;

-- 3. Ensure Room Allocations has owner_id
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='room_allocations' AND column_name='owner_id') THEN
        ALTER TABLE room_allocations ADD COLUMN owner_id UUID REFERENCES profiles(id);
    END IF;
END $$;

-- 4. Reinstall/Fix allocate_room_safely RPC to ensure it accepts owner_id
CREATE OR REPLACE FUNCTION allocate_room_safely(
    p_student_id UUID,
    p_room_id UUID,
    p_start_date DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_room_capacity INT;
    v_active_occupants INT;
    v_student_status TEXT;
    v_already_allocated INT;
    v_allocation_id UUID;
    v_owner_id UUID;
BEGIN
    -- 1. Check if student is active
    SELECT status INTO v_student_status FROM students WHERE id = p_student_id FOR SHARE;
    
    IF v_student_status IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'RES_001', 'message', 'Student not found');
    END IF;
    
    IF v_student_status != 'ACTIVE' THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'VAL_002', 'message', 'Student must be ACTIVE to be allocated a room');
    END IF;

    -- 2. Check for overlapping allocation
    SELECT count(*) INTO v_already_allocated FROM room_allocations 
    WHERE student_id = p_student_id 
    AND (end_date IS NULL OR (p_start_date >= start_date AND p_start_date < end_date));
    
    IF v_already_allocated > 0 THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'RES_002', 'message', 'Student already has an active or overlapping allocation');
    END IF;

    -- 3. Lock the room row, get capacity AND owner_id
    SELECT capacity, owner_id INTO v_room_capacity, v_owner_id FROM rooms WHERE id = p_room_id FOR UPDATE;
    
    IF v_room_capacity IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'RES_001', 'message', 'Room not found');
    END IF;

    -- 4. Count active occupants
    SELECT count(*) INTO v_active_occupants FROM room_allocations 
    WHERE room_id = p_room_id AND end_date IS NULL;
    
    -- 5. Validate capacity
    IF v_active_occupants >= v_room_capacity THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'VAL_002', 'message', 'Room is at full capacity');
    END IF;

    -- 6. Perform the allocation
    INSERT INTO room_allocations (student_id, room_id, start_date, owner_id)
    VALUES (p_student_id, p_room_id, p_start_date, v_owner_id)
    RETURNING id INTO v_allocation_id;

    RETURN jsonb_build_object(
        'success', true, 
        'data', jsonb_build_object(
            'allocation_id', v_allocation_id,
            'student_id', p_student_id,
            'room_id', p_room_id,
            'start_date', p_start_date,
            'current_occupancy', v_active_occupants + 1,
            'remaining_capacity', v_room_capacity - (v_active_occupants + 1)
        )
    );

EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'SYS_001', 'message', SQLERRM);
END;
$$;
