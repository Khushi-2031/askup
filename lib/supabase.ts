import { createClient } from '@supabase/supabase-js';

// Fallbacks prevent build-time SSR crash; real values must be set in production env
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://placeholder.supabase.co';
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder-key';

export const supabase = createClient(url, key);
