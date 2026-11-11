/**
 * ELUM's policies, which live on the ELUM website. Every app links to them from the account menu,
 * and Service terms opens at the part for this app. The same file lives in every app.
 */
import { ELUM_APPS, type ElumAppId } from './platform';

const HOME = ELUM_APPS.find((a) => a.id === 'home')!.url;

export const LEGAL_PAGES = [
  { path: 'terms', label: 'Terms of service' },
  { path: 'service-terms', label: 'Service terms' },
  { path: 'privacy', label: 'Privacy policy' },
  { path: 'ads', label: 'Ads policy' },
  { path: 'do-not-sell', label: 'Do Not Sell or Share My Personal Information' },
  { path: 'disclaimer', label: 'Disclaimer' },
  { path: 'copyright', label: 'Copyright and takedowns' },
  { path: 'legal', label: 'All policies' },
] as const;

export type LegalPath = (typeof LEGAL_PAGES)[number]['path'];

/** A policy's address. Service terms open at the part for `app`. */
export const legalUrl = (path: LegalPath, app?: ElumAppId) => `${HOME}/${path}${path === 'service-terms' && app ? `#${app}` : ''}`;

export const openLegal = (path: LegalPath, app?: ElumAppId) => {
  window.open(legalUrl(path, app), '_blank', 'noopener');
};
