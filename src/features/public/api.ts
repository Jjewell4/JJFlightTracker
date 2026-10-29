import { getSupabase } from '@/services/sync/supabase';
import { normalizeShare, type PublicProfile, type PublicShare } from './profile';
const COLUMNS = 'slug,display_name,flights,published_at,exact_dates';
/** Before public-profiles.sql adds `share`, a missing column must not lock owners out. */
const missingColumn = (e: { code?: string } | null) => e?.code === '42703' || e?.code === 'PGRST204';

export async function loadOwnProfile(
  userId: string,
): Promise<PublicProfile | null> {
  const sb = await getSupabase();
  const query = (columns: string) => sb.from('public_profiles').select(columns).eq('user_id', userId).maybeSingle<PublicProfile>();
  let { data, error } = await query(`${COLUMNS},share`);
  if (missingColumn(error)) ({ data, error } = await query(COLUMNS));
  if (error) throw error;
  return data && { ...data, share: normalizeShare(data.share) };
}
export async function publishProfile(
  userId: string,
  profile: Pick<PublicProfile, 'slug' | 'display_name' | 'exact_dates'> & { share: PublicShare },
): Promise<PublicProfile> {
  const sb = await getSupabase();
  const share = normalizeShare(profile.share);
  const upsert = (row: object, columns: string) =>
    sb.from('public_profiles').upsert({ ...row, user_id: userId }, { onConflict: 'user_id' }).select(columns).single<PublicProfile>();
  let { data, error } = await upsert({ ...profile, share }, `${COLUMNS},share`);
  // Nothing extra to share yet: publishing still works on an older database.
  if (missingColumn(error) && !Object.keys(share).length) ({ data, error } = await upsert({ slug: profile.slug, display_name: profile.display_name, exact_dates: profile.exact_dates }, COLUMNS));
  if (error || !data) throw error;
  return { ...data, share: normalizeShare(data.share) };
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
