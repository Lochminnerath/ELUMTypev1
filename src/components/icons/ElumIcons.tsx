import type { CSSProperties, ReactNode } from 'react';
import './ElumIcons.css';

/**
 * ELUM action icons. Line drawings in the text colour, each with one colour-coded part (a disc,
 * a lid, a star) so actions are told apart at a glance: archive is blue, delete red, share ELUM
 * blue, restore green, spam amber, and so on. The colours are CSS variables (ElumIcons.css), so
 * a theme can tune them. Same props as the line icons used elsewhere: size and strokeWidth.
 */
export interface IconProps {
  size?: number;
  strokeWidth?: number;
  className?: string;
  'aria-label'?: string;
}

type Kind =
  | 'archive'
  | 'delete'
  | 'share'
  | 'restore'
  | 'spam'
  | 'unread'
  | 'reply'
  | 'reply-all'
  | 'forward'
  | 'download'
  | 'duplicate'
  | 'link'
  | 'star'
  | 'rename'
  | 'new'
  | 'sign-out'
  | 'print'
  | 'invite';

function make(kind: Kind, draw: (accent: string) => ReactNode) {
  function Icon({ size = 20, strokeWidth = 1.75, className, 'aria-label': label }: IconProps) {
    return (
      <svg
        className={`elum-icon elum-icon--${kind}${className ? ` ${className}` : ''}`}
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        role={label ? 'img' : undefined}
        aria-label={label}
        aria-hidden={label ? undefined : true}
        style={{ '--elum-icon-accent': `var(--elum-icon-${kind})` } as CSSProperties}
      >
        {draw('var(--elum-icon-accent)')}
      </svg>
    );
  }
  Icon.displayName = `ElumIcon(${kind})`;
  return Icon;
}

/** A box with its lid; the lid's handle is the colour. */
export const ArchiveIcon = make('archive', (a) => (
  <>
    <rect x="3" y="4" width="18" height="5" rx="1.6" />
    <path d="M5 9v9.2A1.8 1.8 0 0 0 6.8 20h10.4a1.8 1.8 0 0 0 1.8-1.8V9" />
    <path d="M10 13h4" />
    <circle cx="12" cy="6.5" r="1.25" fill={a} stroke="none" />
  </>
));

/** A bin whose lid is red. */
export const DeleteIcon = make('delete', (a) => (
  <>
    <path d="M6 8l.9 11.1A1.6 1.6 0 0 0 8.5 20.6h7a1.6 1.6 0 0 0 1.6-1.5L18 8" />
    <path d="M10 11.5v5.5M14 11.5v5.5" />
    <rect x="3.6" y="5" width="16.8" height="3" rx="1.5" fill={a} stroke={a} />
    <path d="M9.5 5V3.9a.9.9 0 0 1 .9-.9h3.2a.9.9 0 0 1 .9.9V5" />
  </>
));

/** Three connected people: the one sharing is the coloured disc. */
export const ShareIcon = make('share', (a) => (
  <>
    <path d="M8.3 10.8l7.4-4M8.3 13.2l7.4 4" />
    <circle cx="6" cy="12" r="3" fill={a} stroke={a} />
    <circle cx="18" cy="5.5" r="2.6" />
    <circle cx="18" cy="18.5" r="2.6" />
  </>
));

/** Back where it came from: a turning arrow around a green disc. */
export const RestoreIcon = make('restore', (a) => (
  <>
    <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" />
    <path d="M4 4.5v3.7h3.7" />
    <circle cx="12" cy="12" r="2.4" fill={a} stroke="none" />
  </>
));

/** A shield with an amber mark. */
export const SpamIcon = make('spam', (a) => (
  <>
    <path d="M12 3l7 2.8v5.6c0 4.3-2.9 7.7-7 9.6-4.1-1.9-7-5.3-7-9.6V5.8L12 3z" />
    <path d="M12 7.6v5.2" stroke={a} strokeWidth="2.4" />
    <circle cx="12" cy="16.1" r="1.35" fill={a} stroke="none" />
  </>
));

/** A letter with the unread dot. */
export const UnreadIcon = make('unread', (a) => (
  <>
    <rect x="3" y="6" width="15.5" height="12.5" rx="2" />
    <path d="M3.6 7.2l7.6 5.6 7-5.2" />
    <circle cx="19.2" cy="6" r="3" fill={a} stroke="var(--surface, #fff)" strokeWidth="1.6" />
  </>
));

/** Reply: an arrow back, starting from a coloured disc. */
export const ReplyIcon = make('reply', (a) => (
  <>
    <path d="M9.5 6L4 11.5 9.5 17" />
    <path d="M4.5 11.5h9a5.5 5.5 0 0 1 5.5 5.5v1" />
    <circle cx="19" cy="18.5" r="2" fill={a} stroke="none" />
  </>
));

export const ReplyAllIcon = make('reply-all', (a) => (
  <>
    <path d="M11 6l-5.5 5.5L11 17" />
    <path d="M7 6l-5 5.5L7 17" />
    <path d="M6 11.5h8a5.5 5.5 0 0 1 5.5 5.5v1" />
    <circle cx="19.5" cy="18.5" r="2" fill={a} stroke="none" />
  </>
));

export const ForwardIcon = make('forward', (a) => (
  <>
    <path d="M14.5 6l5.5 5.5-5.5 5.5" />
    <path d="M19.5 11.5h-9A5.5 5.5 0 0 0 5 17v1" />
    <circle cx="5" cy="18.5" r="2" fill={a} stroke="none" />
  </>
));

/** Into the tray, with the coloured disc landing. */
export const DownloadIcon = make('download', (a) => (
  <>
    <path d="M12 3.5v9.5M8 9.5l4 4 4-4" />
    <path d="M4 15.5v2.3A2.2 2.2 0 0 0 6.2 20h11.6a2.2 2.2 0 0 0 2.2-2.2v-2.3" />
    <circle cx="12" cy="17" r="1.5" fill={a} stroke="none" />
  </>
));

/** Two cards, the copy in colour. */
export const DuplicateIcon = make('duplicate', (a) => (
  <>
    <rect x="3.5" y="3.5" width="12" height="12" rx="2.5" />
    <rect x="8.5" y="8.5" width="12" height="12" rx="2.5" fill={a} fillOpacity="0.22" stroke={a} />
    <path d="M14.5 12v5M12 14.5h5" stroke={a} />
  </>
));

/** Two discs linked: a link to copy. */
export const LinkIcon = make('link', (a) => (
  <>
    <path d="M10 14l4-4" />
    <path d="M8.6 10.6L6.5 12.7a3.3 3.3 0 0 0 4.7 4.7l2.1-2.1" />
    <path d="M15.4 13.4l2.1-2.1a3.3 3.3 0 0 0-4.7-4.7l-2.1 2.1" />
    <circle cx="19" cy="5" r="2" fill={a} stroke="none" />
  </>
));

export const StarIcon = make('star', (a) => (
  <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9L12 3.5z" fill={a} stroke={a} />
));

/** A pencil with a coloured tip. */
export const RenameIcon = make('rename', (a) => (
  <>
    <path d="M14.5 5.5l4 4L9 19H5v-4l9.5-9.5z" />
    <path d="M12.5 7.5l4 4" />
    <path d="M5 15v4h4z" fill={a} stroke={a} />
  </>
));

/** Something new: a coloured disc with a plus. */
export const NewIcon = make('new', (a) => (
  <>
    <circle cx="12" cy="12" r="8.5" fill={a} stroke={a} />
    <path d="M12 8v8M8 12h8" stroke="#fff" strokeWidth="2" />
  </>
));

export const SignOutIcon = make('sign-out', (a) => (
  <>
    <path d="M10 4H6.5A2.5 2.5 0 0 0 4 6.5v11A2.5 2.5 0 0 0 6.5 20H10" />
    <path d="M15.5 8l4 4-4 4M19 12H9.5" />
    <circle cx="9.5" cy="12" r="1.6" fill={a} stroke="none" />
  </>
));

export const PrintIcon = make('print', (a) => (
  <>
    <path d="M7 8V3.8h10V8" />
    <rect x="3.5" y="8" width="17" height="8.5" rx="2" />
    <rect x="7" y="13.5" width="10" height="7" rx="1" />
    <circle cx="17" cy="11" r="1.2" fill={a} stroke="none" />
  </>
));

/** A person and a coloured plus: invite someone. */
export const InviteIcon = make('invite', (a) => (
  <>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M3 19.5c.6-3.4 3-5.5 6-5.5s5.4 2.1 6 5.5" />
    <circle cx="18.5" cy="9" r="3.5" fill={a} stroke={a} />
    <path d="M18.5 7.4v3.2M16.9 9h3.2" stroke="#fff" strokeWidth="1.6" />
  </>
));
