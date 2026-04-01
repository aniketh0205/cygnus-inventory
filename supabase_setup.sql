-- Cygnus Logistics Supabase Setup Script (Auth & RLS Migration)
-- Run this entire script in the SQL Editor in your Supabase Dashboard

-- 1. Create the Items table (we use text for image to seamlessly store Base64)
CREATE TABLE IF NOT EXISTS items (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    quantity INTEGER DEFAULT 1,
    description TEXT,
    notes TEXT,
    location TEXT,
    image TEXT
);

-- 2. Create the Access Logs table
CREATE TABLE IF NOT EXISTS access_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username TEXT NOT NULL,
    action TEXT NOT NULL,
    timestamp TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Create the Profiles table (links to auth.users)
CREATE TABLE IF NOT EXISTS profiles (
    id UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
    username TEXT UNIQUE NOT NULL,
    role TEXT NOT NULL,
    status TEXT NOT NULL
);

-- 4. Enable Row Level Security (RLS) on all tables
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE items ENABLE ROW LEVEL SECURITY;
ALTER TABLE access_logs ENABLE ROW LEVEL SECURITY;

-- 5. Define RLS Policies for Profiles
DROP POLICY IF EXISTS "Allow authenticated read on profiles" ON profiles;
CREATE POLICY "Allow authenticated read on profiles" ON profiles FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Allow update on profiles" ON profiles;
CREATE POLICY "Allow update on profiles" ON profiles FOR UPDATE TO authenticated USING (
    auth.uid() = id OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);

DROP POLICY IF EXISTS "Allow admin insert on profiles" ON profiles;
CREATE POLICY "Allow admin insert on profiles" ON profiles FOR INSERT TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);

DROP POLICY IF EXISTS "Allow admin delete on profiles" ON profiles;
CREATE POLICY "Allow admin delete on profiles" ON profiles FOR DELETE TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);

-- 6. Define RLS Policies for Items
DROP POLICY IF EXISTS "Allow authenticated read on items" ON items;
CREATE POLICY "Allow authenticated read on items" ON items FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Allow elevated modify on items" ON items;
CREATE POLICY "Allow elevated modify on items" ON items FOR INSERT TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'team'))
);

DROP POLICY IF EXISTS "Allow elevated update on items" ON items;
CREATE POLICY "Allow elevated update on items" ON items FOR UPDATE TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'team'))
);

DROP POLICY IF EXISTS "Allow elevated delete on items" ON items;
CREATE POLICY "Allow elevated delete on items" ON items FOR DELETE TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'team'))
);

-- 7. Define RLS Policies for Access Logs
DROP POLICY IF EXISTS "Allow authenticated insert logs" ON access_logs;
CREATE POLICY "Allow authenticated insert logs" ON access_logs FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Allow authenticated read logs" ON access_logs;
CREATE POLICY "Allow authenticated read logs" ON access_logs FOR SELECT TO authenticated USING (true);

-- 8. Allow authenticated users to create their OWN profile (for first-login auto-setup)
-- This is secure: users can ONLY insert a row where id matches their own auth.uid()
DROP POLICY IF EXISTS "Allow self insert on profiles" ON profiles;
CREATE POLICY "Allow self insert on profiles" ON profiles FOR INSERT TO authenticated WITH CHECK (id = auth.uid());

-- Clean up any broken admin users from previous manual SQL attempts
DELETE FROM profiles WHERE username = 'admin';
DELETE FROM auth.users WHERE email = 'admin@cygnus.local';

-- Remove any old trigger that might be causing issues
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user();

-- 9. Admin RPC Functions
-- Safely creates a user bypassing email confirmation (callable only by admins)
CREATE OR REPLACE FUNCTION admin_create_user(p_username TEXT, p_password TEXT, p_role TEXT, p_status TEXT)
RETURNS void AS $$
DECLARE
    new_uid UUID := gen_random_uuid();
BEGIN
    -- Check if the executor is an admin
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin') THEN
        RAISE EXCEPTION 'Unauthorized: Only admins can create users';
    END IF;

    -- Insert into auth.users (auto confirming email)
    INSERT INTO auth.users (
        id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
    ) VALUES (
        new_uid, 'authenticated', 'authenticated', p_username || '@cygnus.local',
        extensions.crypt(p_password, extensions.gen_salt('bf', 10)),
        now(),
        '{"provider":"email","providers":["email"]}',
        '{}', now(), now()
    );
    
    -- Insert into auth.identities
    INSERT INTO auth.identities (
        id, provider_id, user_id, identity_data, provider, created_at, updated_at
    ) VALUES (
        gen_random_uuid(), new_uid::text, new_uid, format('{"sub":"%s","email":"%s"}', new_uid::text, p_username || '@cygnus.local')::jsonb, 'email', now(), now()
    );

    -- Insert into profiles
    INSERT INTO profiles (id, username, role, status) VALUES (new_uid, p_username, p_role, p_status);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Safely deletes a user across both tables
CREATE OR REPLACE FUNCTION admin_delete_user(p_uid UUID)
RETURNS void AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin') THEN
        RAISE EXCEPTION 'Unauthorized: Only admins can delete users';
    END IF;
    -- Deleting from auth.users naturally cascades into the profiles table
    DELETE FROM auth.users WHERE id = p_uid;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Master credentials self-update
CREATE OR REPLACE FUNCTION admin_update_credentials(p_new_username TEXT, p_new_password TEXT)
RETURNS void AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin') THEN
        RAISE EXCEPTION 'Unauthorized';
    END IF;

    -- Update auth.users
    UPDATE auth.users 
    SET email = p_new_username || '@cygnus.local',
        encrypted_password = extensions.crypt(p_new_password, extensions.gen_salt('bf', 10)),
        updated_at = now()
    WHERE id = auth.uid();
    
    -- Update auth.identities
    UPDATE auth.identities
    SET identity_data = format('{"sub":"%s","email":"%s"}', auth.uid()::text, p_new_username || '@cygnus.local')::jsonb
    WHERE user_id = auth.uid() AND provider = 'email';
    
    -- Update profiles
    UPDATE profiles
    SET username = p_new_username
    WHERE id = auth.uid();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 10. Checkouts Table (Check-In / Check-Out)
-- ============================================
CREATE TABLE IF NOT EXISTS checkouts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    item_name TEXT NOT NULL,
    checked_out_by TEXT NOT NULL,
    quantity INTEGER DEFAULT 1,
    checked_out_at TIMESTAMPTZ DEFAULT NOW(),
    expected_return TIMESTAMPTZ,
    returned_at TIMESTAMPTZ,
    notes TEXT
);

ALTER TABLE checkouts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow authenticated read checkouts" ON checkouts;
CREATE POLICY "Allow authenticated read checkouts" ON checkouts FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Allow elevated insert checkouts" ON checkouts;
CREATE POLICY "Allow elevated insert checkouts" ON checkouts FOR INSERT TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'team'))
);

DROP POLICY IF EXISTS "Allow elevated update checkouts" ON checkouts;
CREATE POLICY "Allow elevated update checkouts" ON checkouts FOR UPDATE TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'team'))
);

DROP POLICY IF EXISTS "Allow elevated delete checkouts" ON checkouts;
CREATE POLICY "Allow elevated delete checkouts" ON checkouts FOR DELETE TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'team'))
);

-- ============================================
-- 11. Categories Table (Dynamic Categories)
-- ============================================
CREATE TABLE IF NOT EXISTS categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT UNIQUE NOT NULL,
    icon TEXT DEFAULT '📦',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow authenticated read categories" ON categories;
CREATE POLICY "Allow authenticated read categories" ON categories FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Allow admin insert categories" ON categories;
CREATE POLICY "Allow admin insert categories" ON categories FOR INSERT TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);

DROP POLICY IF EXISTS "Allow admin update categories" ON categories;
CREATE POLICY "Allow admin update categories" ON categories FOR UPDATE TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);

DROP POLICY IF EXISTS "Allow admin delete categories" ON categories;
CREATE POLICY "Allow admin delete categories" ON categories FOR DELETE TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);

-- Seed default categories (skip if they already exist)
INSERT INTO categories (name, icon) VALUES
    ('Machines', '⚙️'),
    ('Chemicals', '🧪'),
    ('Tools', '🔧'),
    ('Electronics', '💻'),
    ('Pipes', '🔩'),
    ('Stationery', '📝'),
    ('Other', '📦')
ON CONFLICT (name) DO NOTHING;
