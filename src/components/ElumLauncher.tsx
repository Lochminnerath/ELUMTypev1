import { useEffect, useState } from 'react';
import { api } from '../api';
import { openElsewhere } from '../lib/elum';
import { ELUM_APPS } from '../lib/platform';
import { Launcher } from './Launcher';

/** The ELUM launcher with every ELUM app. Apps not on this account yet open in ELUM Store. */
export function ElumLauncher() {
  const [added, setAdded] = useState<string[] | null>(null);
  useEffect(() => {
    let live = true;
    api.elumApps?.().then(
      (apps) => live && setAdded(apps),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, []);
  return <Launcher apps={ELUM_APPS} current="type" added={added} onOpen={(url) => void openElsewhere(url)} />;
}
