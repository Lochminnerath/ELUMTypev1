import type { ThreadKind } from '../api';
import './ChannelMark.css';

const LABEL: Record<ThreadKind, string> = {
  elum: 'Inside ELUM: sent straight from one ELUM account to another',
  email: 'Outside email: came in from outside ELUM',
};

/**
 * How a conversation reached you. Inside ELUM: two ELUM circles, in Type's colour. Outside
 * email: a globe, for mail that came in from the wider internet.
 */
export function ChannelMark({ kind, size = 16, className }: { kind: ThreadKind; size?: number; className?: string }) {
  return (
    <span className={`channel-mark${className ? ` ${className}` : ''}`} data-kind={kind} role="img" aria-label={LABEL[kind]} title={LABEL[kind]}>
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
        {kind === 'elum' ? (
          <>
            <circle cx="6" cy="8" r="4.25" stroke="currentColor" strokeWidth="1.5" />
            <circle cx="10" cy="8" r="4.25" stroke="currentColor" strokeWidth="1.5" />
            <path d="M8 4.55a4.25 4.25 0 0 1 0 6.9a4.25 4.25 0 0 1 0-6.9z" fill="currentColor" />
          </>
        ) : (
          <>
            <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" />
            <path d="M2 8h12M8 2c1.9 1.7 2.8 3.7 2.8 6S9.9 12.3 8 14C6.1 12.3 5.2 10.3 5.2 8S6.1 3.7 8 2z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
          </>
        )}
      </svg>
    </span>
  );
}
