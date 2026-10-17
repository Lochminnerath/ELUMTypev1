import type { Address, Person } from '../api';
import { displayName } from '../api/validation';

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 102.4) / 10} KB`;
  return `${Math.round(bytes / (1024 * 104.8576)) / 10} MB`;
}

/** "Rae", "Rae and Kai", "Rae, Kai and 3 others". */
export function namesOf(people: Address[], max = 2): string {
  const names = people.map((p) => displayName(p).split(' ')[0]);
  if (!names.length) return 'Only you';
  if (names.length === 1) return displayName(people[0]);
  if (names.length <= max) return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  const more = names.length - max;
  return `${names.slice(0, max).join(', ')} and ${more} ${more === 1 ? 'other' : 'others'}`;
}

/** The person a list row is about: the first other person, ELUM people first. */
export function leadPerson(people: Person[]): Person | null {
  return people.find((p) => p.isElum) ?? people[0] ?? null;
}
