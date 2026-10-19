import { ACCOUNT_HOME, MAKE_URL, openElsewhere, TYPE_URL, WRITE_URL } from '../lib/elum';
import { Launcher, type LauncherApp } from './Launcher';

/** The ELUM launcher, with the apps in brand order. Other apps open signed in where they can. */
const LAUNCHER_APPS: LauncherApp[] = [
  { id: 'write', name: 'Write', note: 'Documents', url: WRITE_URL, color: '#f59a52' },
  { id: 'type', name: 'Type', note: 'Mail', url: TYPE_URL, color: '#3fc4a0' },
  { id: 'make', name: 'Make', note: 'Slides and posts', url: MAKE_URL, color: '#ec7fa9' },
  { id: 'account', name: 'Account', note: 'You, everywhere', url: ACCOUNT_HOME, color: '#94c858' },
  { id: 'browse', name: 'Browse', note: 'Search', url: null, color: '#9b84ee' },
  { id: 'store', name: 'Store', note: 'Apps and more', url: null, color: '#e9b949' },
];

export function ElumLauncher() {
  return <Launcher apps={LAUNCHER_APPS} current="type" onOpen={(app) => void openElsewhere(app.url!)} />;
}
