-- Migration 008: Add atomic room allocation logic with row-level locking
-- This function handles the "last bed" race condition by locking the room row during capacity check.

CREATE OR REPLACE FUNCTION allocate_room_safely(
    p_student_id UUID,
    p_room_id UUID,
    p_start_date DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER -- Runs with permissions of creator (admin)
AS $$
DECLARE
    v_room_capacity INT;
    v_active_occupants INT;
    v_student_status TEXT;
    v_already_allocated INT;
    v_allocation_id UUID;
BEGIN
    -- 1. Check if student is active (and lock the student record for consistency)
    SELECT status INTO v_student_status FROM students WHERE id = p_student_id FOR SHARE;
    
    IF v_student_status IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'RES_001', 'message', 'Student not found');
    END IF;
    
    IF v_student_status != 'ACTIVE' THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'VAL_002', 'message', 'Student must be ACTIVE to be allocated a room');
    END IF;

    -- 2. Check for ANY overlapping allocation (Active or Historical)
    -- A new allocation cannot start during an existing period
    SELECT count(*) INTO v_already_allocated FROM room_allocations 
    WHERE student_id = p_student_id 
    AND (
        (end_date IS NULL) OR -- Active
        (p_start_date BETWEEN start_date AND end_date) -- Overlaps historical
    );
    
    IF v_already_allocated > 0 THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'RES_002', 'message', 'Student already has an allocation that overlaps with the requested start date');
    END IF;

    -- 3. Lock the room row and get capacity (CRITICAL: prevents race conditions)
    SELECT capacity INTO v_room_capacity FROM rooms WHERE id = p_room_id FOR UPDATE;
    
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
    INSERT INTO room_allocations (student_id, room_id, start_date)
    VALUES (p_student_id, p_room_id, p_start_date)
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
