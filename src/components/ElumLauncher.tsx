import { ACCOUNT_HOME, BROWSE_URL, HOME_URL, INQUIRE_URL, MAKE_URL, openElsewhere, STORE_URL, TYPE_URL, WRITE_URL } from '../lib/elum';
import { Launcher, type LauncherApp } from './Launcher';

/** The ELUM launcher, with the apps in brand order. Other apps open signed in where they can. */
const LAUNCHER_APPS: LauncherApp[] = [
  { id: 'write', name: 'Write', note: 'Documents', url: WRITE_URL, color: '#f59a52' },
  { id: 'type', name: 'Type', note: 'Mail', url: TYPE_URL, color: '#3fc4a0' },
  { id: 'make', name: 'Make', note: 'Slides and posts', url: MAKE_URL, color: '#ec7fa9' },
  { id: 'account', name: 'Account', note: 'You, everywhere', url: ACCOUNT_HOME, color: '#94c858' },
  { id: 'browse', name: 'Browse', note: 'Search', url: BROWSE_URL, color: '#9b84ee' },
  { id: 'store', name: 'Store', note: 'Apps and more', url: STORE_URL, color: '#e9b949' },
  { id: 'inquire', name: 'Inquire', note: 'Forms', url: INQUIRE_URL, color: '#f06a5f' },
  { id: 'home', name: 'ELUM', note: 'The front door', url: HOME_URL, color: '#7093f8' },
];

export function ElumLauncher() {
  return <Launcher apps={LAUNCHER_APPS} current="type" onOpen={(app) => void openElsewhere(app.url!)} />;
}
