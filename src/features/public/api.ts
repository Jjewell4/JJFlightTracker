import { getSupabase } from '@/services/sync/supabase';
import type { PublicProfile } from './profile';
export async function loadOwnProfile(
  userId: string,
): Promise<PublicProfile | null> {
  const sb = await getSupabase();
  const { data, error } = await sb
    .from('public_profiles')
    .select('slug,display_name,flights,published_at,exact_dates')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}
export async function publishProfile(
  userId: string,
  profile: Pick<PublicProfile, 'slug' | 'display_name' | 'exact_dates'>,
): Promise<PublicProfile> {
  const sb = await getSupabase();
  const { data, error } = await sb
    .from('public_profiles')
    .upsert({ ...profile, user_id: userId }, { onConflict: 'user_id' })
    .select('slug,display_name,flights,published_at,exact_dates')
    .single();
  if (error) throw error;
  return data;
}
export async function unpublishProfile(userId: string) {
  const sb = await getSupabase();
  const { error } = await sb
    .from('public_profiles')
    .delete()
    .eq('user_id', userId);
  if (error) throw error;
}
export async function loadPublicProfile(
  slug: string,
): Promise<PublicProfile | null> {
  const sb = await getSupabase();
  const { data, error } = await sb.rpc('get_public_profile', { handle: slug });
  if (error) throw error;
  return data?.[0] ?? null;
}
export function profileError(e: unknown): string {
  const error = e as { code?: string; message?: string };
  if (error.code === '23505')
    return 'That URL is already taken. Choose another handle.';
  if (
    error.code === '42703' ||
    error.code === 'PGRST204' ||
    error.code === '42P01' ||
    error.code === 'PGRST205' ||
    error.code === 'PGRST202'
  )
    return 'Public sharing is not available yet. The public-profile database migration must be installed.';
  return error.message || 'Could not reach public sharing. Please try again.';
}
