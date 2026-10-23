import type { ReactNode } from 'react';
import { PASSKEY_TROUBLESHOOTING_URL, TROUBLESHOOTING_URL, supportUrl } from '../lib/support';

interface SupportLinkProps {
  /** The product id of this app, such as "write". */
  app: string;
  /** A short code for what failed, such as "send-failed". */
  code?: string;
  /** What the screen said. */
  message?: string;
  children?: ReactNode;
}

/** A quiet "Contact support" button. Only show it where something went wrong. */
export function SupportLink({ app, code, message, children = 'Contact support' }: SupportLinkProps) {
  const from = typeof window === 'undefined' ? undefined : window.location.pathname;
  return (
    <a
      className="elum-btn elum-btn--quiet elum-btn--sm support-link"
      href={supportUrl(app, { code, message, from })}
      target="_blank"
      rel="noopener noreferrer"
    >
      {children}
    </a>
  );
}

/** A quiet link to the troubleshooting guide, or to one of its sections. */
export function TroubleshootingLink({ topic, children = 'Troubleshooting' }: { topic?: 'passkeys'; children?: ReactNode }) {
  return (
    <a
      className="elum-btn elum-btn--quiet elum-btn--sm support-link"
      href={topic === 'passkeys' ? PASSKEY_TROUBLESHOOTING_URL : TROUBLESHOOTING_URL}
      target="_blank"
      rel="noopener noreferrer"
    >
      {children}
    </a>
  );
}

/** Contact support and Troubleshooting side by side, for error screens. */
export function SupportLinks({ app, code, message }: Omit<SupportLinkProps, 'children'>) {
  return (
    <div className="support-links">
      <SupportLink app={app} code={code} message={message} />
      <TroubleshootingLink />
    </div>
  );
}
