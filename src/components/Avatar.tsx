export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const first = parts[0][0];
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase();
}

/**
 * A circle in the person's colour with their initials. People outside ELUM have no colour,
 * so they get a quiet outlined circle instead.
 */
export function Avatar({ user, size = 32, title }: { user: { name: string; color?: string | null }; size?: number; title?: string }) {
  const outside = !user.color;
  return (
    <span
      className="avatar"
      data-outside={outside || undefined}
      title={title}
      aria-hidden={title ? undefined : true}
      style={{ width: size, height: size, background: user.color ?? undefined, fontSize: Math.max(10, Math.round(size * 0.38)) }}
    >
      {initials(user.name)}
    </span>
  );
}
