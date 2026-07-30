-- Migration 015: Fix allocation RPC to include owner_id and allow same-day re-allocation
-- This version fetches owner_id from the rooms table to satisfy NOT NULL constraints.

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
    -- Use [start, end) range check for historical to allow same-day re-assignment
    SELECT count(*) INTO v_already_allocated FROM room_allocations 
    WHERE student_id = p_student_id 
    AND (
        (end_date IS NULL) OR -- Active
        (p_start_date >= start_date AND p_start_date < end_date) -- Overlaps historical (exclusive of end_date)
    );
    
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

    -- 6. Perform the allocation (INCLUDING owner_id)
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
