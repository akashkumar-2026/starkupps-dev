/** Presentation helpers for a Supabase user record. */

/** Best available human name: metadata, then email local-part, then phone. */
export function displayName(user: {
  user_metadata?: Record<string, unknown>;
  email?: string | null;
  phone?: string | null;
}): string {
  const metadata = user.user_metadata;
  const fullName = metadata?.["full_name"];
  const name = metadata?.["name"];

  if (typeof fullName === "string" && fullName.trim()) return fullName;
  if (typeof name === "string" && name.trim()) return name;
  if (user.email) return user.email.split("@")[0] ?? "";
  return user.phone ?? "StarKupps fan";
}

/** Up to two uppercase initials for avatar fallbacks. */
export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
