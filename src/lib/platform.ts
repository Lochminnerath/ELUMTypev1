/**
 * What every ELUM app shares about the others: the apps themselves, in brand order, with their
 * colours, and how an app hears from the ELUM Console (its mode, message, incidents and flags).
 * The same file lives in every app.
 */
const env = import.meta.env as Record<string, string | undefined>;
const at = (name: string, fallback: string) => (env[name]?.trim() ? env[name]!.trim().replace(/\/+$/, '') : fallback);

export type ElumAppId = 'write' | 'type' | 'make' | 'account' | 'browse' | 'store' | 'inquire' | 'tune' | 'code' | 'capture' | 'home';

export interface ElumApp {
  id: ElumAppId;
  name: string;
  note: string;
  url: string;
  color: string;
}

export const ELUM_APPS: ElumApp[] = [
  { id: 'write', name: 'Write', note: 'Documents', url: at('VITE_ELUM_WRITE_URL', 'https://writebyelum.netlify.app'), color: '#f59a52' },
  { id: 'type', name: 'Type', note: 'Mail', url: at('VITE_ELUM_TYPE_URL', 'https://typebyelum.netlify.app'), color: '#3fc4a0' },
  { id: 'make', name: 'Make', note: 'Slides and posts', url: at('VITE_ELUM_MAKE_URL', 'https://makebyelum.netlify.app'), color: '#ec7fa9' },
  { id: 'account', name: 'Account', note: 'You, everywhere', url: at('VITE_ELUM_ACCOUNT_URL', 'https://accountsbyelum.netlify.app'), color: '#94c858' },
  { id: 'browse', name: 'Browse', note: 'Search', url: at('VITE_ELUM_BROWSE_URL', 'https://browsebyelum.netlify.app'), color: '#9b84ee' },
  { id: 'store', name: 'Store', note: 'Apps and more', url: at('VITE_ELUM_STORE_URL', 'https://storebyelum.netlify.app'), color: '#e9b949' },
  { id: 'inquire', name: 'Inquire', note: 'Forms', url: at('VITE_ELUM_INQUIRE_URL', 'https://inquirebyelum.netlify.app'), color: '#f06a5f' },
  { id: 'tune', name: 'Tune', note: 'Music', url: at('VITE_ELUM_TUNE_URL', 'https://tunebyelum.netlify.app'), color: '#48bfe3' },
  { id: 'code', name: 'Code', note: 'Coding', url: at('VITE_ELUM_CODE_URL', 'https://codebyelum.netlify.app'), color: '#d27fe0' },
  { id: 'capture', name: 'Capture', note: 'Photos', url: at('VITE_ELUM_CAPTURE_URL', 'https://capturebyelum.netlify.app'), color: '#5ec46f' },
  { id: 'home', name: 'ELUM', note: 'elum.space', url: at('VITE_ELUM_HOME_URL', 'https://elum.netlify.app'), color: '#7093f8' },
];

/** Come with every account: nothing to add. The rest are added from ELUM Store with Get. */
export const ALWAYS_THERE: ElumAppId[] = ['account', 'store', 'browse', 'home'];

/** An app's page in ELUM Store, where Get adds it to the account. */
export const storePage = (id: ElumAppId) => `${ELUM_APPS.find((a) => a.id === 'store')!.url}/apps/${id}`;

export const STATUS_PAGE = at('VITE_ELUM_STATUS_URL', 'https://browsebyelum.netlify.app/status');

export type ServiceMode = 'normal' | 'notice' | 'read_only' | 'maintenance';

/** This app as the ELUM Console set it (public.elum_service_state). */
export interface ServiceState {
  service: string;
  mode: ServiceMode;
  message: string;
  incidents: { id: string; severity: 'maintenance' | 'degraded' | 'outage'; title: string; message: string; startedAt: string }[];
  flags: Record<string, unknown>;
}
