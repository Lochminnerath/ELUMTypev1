const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** "Just now", "12 min ago", "3:42 PM", "Yesterday", "Oct 12", "Oct 12, 2024". */
export function formatWhen(iso: string, now = new Date()): string {
  const date = new Date(iso);
  const diff = now.getTime() - date.getTime();
  if (diff >= 0 && diff < MINUTE) return 'Just now';
  if (diff >= 0 && diff < HOUR) return `${Math.floor(diff / MINUTE)} min ago`;
  if (sameDay(date, now)) return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(date, yesterday)) return 'Yesterday';
  const options: Intl.DateTimeFormatOptions =
    date.getFullYear() === now.getFullYear() ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' };
  return date.toLocaleDateString(undefined, options);
}

/** Full date and time for tooltips. */
export function formatFull(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** For use mid-sentence: "Edited just now", "Opened yesterday". */
export function formatWhenInline(iso: string, now = new Date()): string {
  const when = formatWhen(iso, now);
  return when === 'Just now' || when === 'Yesterday' ? when.toLowerCase() : when;
}
