import { useEffect, useState } from 'react';
import { displayName } from '../api/validation';
import { colourFor, usePicture } from '../lib/pictures';
import { Avatar } from './Avatar';

/**
 * Anyone in Type: their picture when there is one to show, or a circle in an ELUM colour with
 * their initials. ELUM people keep the colour they chose; everyone else gets one from the list.
 */
export function PersonAvatar({
  person,
  size = 32,
  title,
}: {
  person: { address: string; name?: string | null; isElum?: boolean; color?: string | null };
  size?: number;
  title?: string;
}) {
  const found = usePicture(person);
  const [broken, setBroken] = useState<string | null>(null);
  useEffect(() => setBroken(null), [found]);
  const name = displayName(person);
  const colour = (person.isElum && person.color) || colourFor(person.address);
  const picture = found && broken !== found ? found : null;
  return <Avatar user={{ name, color: colour, pictureUrl: picture }} size={size} title={title} onPictureError={() => setBroken(found)} />;
}
