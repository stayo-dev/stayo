-- Manual Admin Setup
-- Password: admin123
-- Bcrypt Hash: $2b$12$HEv/O9.YpAmsN0VvYmYrIu7B8jLRE6C.KxS6S5S/M/8W5vYmY7G2e

INSERT INTO profiles (name, email, phone, role, password_hash)
VALUES ('System Admin', 'admin@hms.com', '1234567890', 'admin', '$2b$12$HEv/O9.YpAmsN0VvYmYrIu7B8jLRE6C.KxS6S5S/M/8W5vYmY7G2e')
ON CONFLICT (email) DO UPDATE 
SET password_hash = EXCLUDED.password_hash,
    role = 'admin';
