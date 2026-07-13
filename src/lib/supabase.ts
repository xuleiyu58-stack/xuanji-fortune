import { createClient, SupabaseClient } from "@supabase/supabase-js";

let _supabase: SupabaseClient | null = null;

function getSupabase(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  if (!_supabase) {
    _supabase = createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
  }
  return _supabase;
}

export const supabase = getSupabase();
export const getSupabaseClient = getSupabase;

export function getSupabaseAuth() {
  return getSupabase()?.auth;
}

export function getSupabaseFrom() {
  return getSupabase()?.from.bind(getSupabase());
}

export interface Profile {
  id: string;
  email: string;
  username: string | null;
  bio: string | null;
  avatar_url: string | null;
  is_member: boolean;
  member_expires_at: string | null;
  created_at: string;
}

export interface Reading {
  id: string;
  user_id: string;
  mode: string;
  title: string;
  icon: string;
  result: string;
  input: Record<string, string>;
  created_at: string;
}

export interface DbOrder {
  id: string;
  user_id: string;
  amount: string;
  plan: string;
  status: "pending" | "confirmed" | "rejected";
  contact: string;
  created_at: string;
}
