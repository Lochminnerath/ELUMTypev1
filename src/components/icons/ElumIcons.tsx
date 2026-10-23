import type { CSSProperties, ReactNode } from 'react';
import './ElumIcons.css';

/**
 * ELUM action icons, drawn from the same parts as the ELUM marks: rings, solid discs and the
 * petal where two circles overlap. Lines are in the text colour; each icon has one colour-coded
 * part (a disc, a petal) so actions are told apart at a glance: archive is blue, delete red,
 * restore green, and so on. The colours are CSS variables (ElumIcons.css), so a theme can tune
 * them. Same props as the line icons used elsewhere: size and strokeWidth.
 */
export interface IconProps {
  size?: number;
  strokeWidth?: number;
  className?: string;
  /** The line colour, if not the text colour around it. */
  color?: string;
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
  | 'invite'
  | 'send'
  | 'compose'
  | 'private'
  | 'unlocked'
  | 'visible'
  | 'hidden'
  | 'saved'
  | 'offline'
  | 'verified'
  | 'warning'
  | 'attach'
  | 'remove-person'
  | 'present'
  | 'open';

function make(kind: Kind, draw: (accent: string) => ReactNode) {
  function Icon({ size = 20, strokeWidth = 1.75, className, color, 'aria-label': label }: IconProps) {
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
        style={{ '--elum-icon-accent': `var(--elum-icon-${kind})`, color } as CSSProperties}
      >
        {draw('var(--elum-icon-accent)')}
      </svg>
    );
  }
  Icon.displayName = `ElumIcon(${kind})`;
  return Icon;
}

type Circle = [cx: number, cy: number, r: number];

const n = (v: number) => Math.round(v * 100) / 100;

/**
 * The petal where two circles overlap, as in the ELUM marks: an arc of each circle, the part
 * that lies inside the other.
 */
export function petal([ax, ay, ar]: Circle, [bx, by, br]: Circle): string {
  const dx = bx - ax;
  const dy = by - ay;
  const d = Math.hypot(dx, dy);
  if (d >= ar + br || d <= Math.abs(ar - br)) return '';
  const along = (d * d + ar * ar - br * br) / (2 * d);
  const half = Math.sqrt(ar * ar - along * along);
  const mx = ax + (dx * along) / d;
  const my = ay + (dy * along) / d;
  const p = [n(mx + (dy * half) / d), n(my - (dx * half) / d)];
  const q = [n(mx - (dy * half) / d), n(my + (dx * half) / d)];
  // Each circle's arc inside the other is the long way round only when the chord passes beyond
  // that circle's centre.
  const largeA = along < 0 ? 1 : 0;
  const largeB = d - along < 0 ? 1 : 0;
  return `M${p[0]} ${p[1]}A${ar} ${ar} 0 ${largeA} 1 ${q[0]} ${q[1]}A${br} ${br} 0 ${largeB} 1 ${p[0]} ${p[1]}Z`;
}

const ring = ([cx, cy, r]: Circle, props: Record<string, string | number> = {}) => <circle cx={cx} cy={cy} r={r} {...props} />;
const disc = ([cx, cy, r]: Circle, fill: string) => <circle cx={cx} cy={cy} r={r} fill={fill} stroke="none" />;

/** An arc of a circle from one angle to another, in degrees, clockwise (0 is to the right). */
function arc([cx, cy, r]: Circle, from: number, to: number): string {
  const at = (deg: number) => [n(cx + r * Math.cos((deg * Math.PI) / 180)), n(cy + r * Math.sin((deg * Math.PI) / 180))];
  const [x1, y1] = at(from);
  const [x2, y2] = at(to);
  const sweep = (((to - from) % 360) + 360) % 360;
  return `M${x1} ${y1}A${r} ${r} 0 ${sweep > 180 ? 1 : 0} 1 ${x2} ${y2}`;
}

/** A small coloured disc set into a ring, cut out from it like the discs of the ELUM marks. */
const inset = ([cx, cy, r]: Circle, fill: string) => (
  <>
    <circle cx={cx} cy={cy} r={r + 1.4} fill="var(--surface, #fff)" stroke="none" />
    {disc([cx, cy, r], fill)}
  </>
);

/** A big ring with a small coloured disc on its shoulder: the ELUM pair. */
const BIG: Circle = [10.4, 13.6, 7.4];
const SMALL: Circle = [17.4, 6.6, 4.4];
const pair = (a: string, glyph?: ReactNode) => (
  <>
    {ring(BIG)}
    {inset(SMALL, a)}
    {glyph}
  </>
);
const WHITE = { stroke: '#fff', strokeWidth: 1.6 };

/** A round tin with a coloured lid, a disc for its handle. */
export const ArchiveIcon = make('archive', (a) => (
  <>
    <path d="M5 9.6v2.6a7 7 0 0 0 14 0V9.6" />
    <rect x="3" y="5.4" width="18" height="4.4" rx="2.2" fill={a} stroke={a} />
    <path d="M9.8 13.6h4.4" />
    {disc([12, 3.6, 1.5], a)}
  </>
));

/** The pair, its disc crossed out in red. */
export const DeleteIcon = make('delete', (a) => pair(a, <path d="M15.8 5l3.2 3.2M19 5l-3.2 3.2" {...WHITE} />));

/** Three connected people: the one sharing is the coloured disc. */
export const ShareIcon = make('share', (a) => (
  <>
    <path d="M9.3 10.4c2.2-2.2 3.8-3.4 6-4.1M9.3 13.6c2.2 2.2 3.8 3.4 6 4.1" />
    {disc([6.5, 12, 3.4], a)}
    {ring([18, 5.6, 2.7])}
    {ring([18, 18.4, 2.7])}
  </>
));

/** A ring that turns back on itself around a green disc. */
export const RestoreIcon = make('restore', (a) => (
  <>
    <path d={arc([12, 12, 8], 200, 140)} />
    <path d="M3.2 5.6l1.3 4.4 4.4-1.3" />
    {disc([12, 12, 3.2], a)}
  </>
));

/** A ring with an amber disc held inside it, crossed through: not wanted. */
export const SpamIcon = make('spam', (a) => (
  <>
    {ring([12, 12, 8.6])}
    {disc([12, 12, 4.6], a)}
    <path d="M5.9 18.1L18.1 5.9" />
  </>
));

/** The pair with nothing on the disc: something new waiting to be read. */
export const UnreadIcon = make('unread', (a) => (
  <>
    {pair(a)}
    <path d="M6.4 12.4h6.4M6.4 15.6h4.4" />
  </>
));

/** Speech rings: the coloured reply overlaps the message it answers. */
const SPEECH: Circle = [13.6, 10.6, 7];
const ANSWER_L: Circle = [6, 17.4, 3.6];
const ANSWER_R: Circle = [18, 17.4, 3.6];
export const ReplyIcon = make('reply', (a) => (
  <>
    {ring(SPEECH)}
    {inset(ANSWER_L, a)}
    <path d="M15 7.8l-2.8 2.8 2.8 2.8" />
  </>
));

export const ReplyAllIcon = make('reply-all', (a) => (
  <>
    {ring(SPEECH)}
    {inset(ANSWER_L, a)}
    <path d="M14 7.8l-2.8 2.8 2.8 2.8M17.4 7.8l-2.8 2.8 2.8 2.8" />
  </>
));

const SPEECH_FWD: Circle = [10.4, 10.6, 7];
export const ForwardIcon = make('forward', (a) => (
  <>
    {ring(SPEECH_FWD)}
    {inset(ANSWER_R, a)}
    <path d="M9 7.8l2.8 2.8L9 13.4" />
  </>
));

/** A disc dropping into a round bowl. */
export const DownloadIcon = make('download', (a) => (
  <>
    <path d={arc([12, 12.4, 8], 0, 180)} />
    <path d="M12 3v6.2M9.6 7l2.4 2.4L14.4 7" />
    {disc([12, 15.4, 2.8], a)}
  </>
));

/** Two rings, the copy in colour, their petal shared. */
const ORIGINAL: Circle = [9.2, 9.6, 5.8];
const COPY: Circle = [14.8, 14.4, 5.8];
export const DuplicateIcon = make('duplicate', (a) => (
  <>
    {ring(ORIGINAL)}
    <path d={petal(ORIGINAL, COPY)} fill={a} stroke="none" />
    {ring(COPY, { stroke: a })}
  </>
));

/** Two rounded links joined, one in colour. */
export const LinkIcon = make('link', (a) => (
  <>
    <rect x="2.6" y="8.2" width="11" height="7.6" rx="3.8" />
    <rect x="10.4" y="8.2" width="11" height="7.6" rx="3.8" stroke={a} />
    {disc([12, 12, 1.4], a)}
  </>
));

/** A star on a coloured disc. */
export const StarIcon = make('star', (a) => (
  <>
    {disc([12, 12, 9.4], a)}
    <path d="M12 6.4l1.7 3.5 3.8.5-2.8 2.7.7 3.8L12 15.1l-3.4 1.8.7-3.8-2.8-2.7 3.8-.5L12 6.4z" fill="#fff" stroke="#fff" strokeWidth="1" />
  </>
));

/** A ring with a text cursor in it, the cursor's dot in colour. */
export const RenameIcon = make('rename', (a) => (
  <>
    {ring([12, 12, 8.6])}
    <path d="M12 7.6v8.8M10.2 7.6h3.6M10.2 16.4h3.6" />
    {disc([16.4, 16.4, 2.2], a)}
  </>
));

/** A coloured disc with a plus, a small ring beside it. */
const NEW_DISC: Circle = [13.4, 10.6, 7.6];
export const NewIcon = make('new', (a) => (
  <>
    {ring([5.6, 18.4, 2.8])}
    {disc(NEW_DISC, a)}
    <path d="M13.4 7v7.2M9.8 10.6H17" {...WHITE} strokeWidth="2" />
  </>
));

/** A ring left open, a coloured disc leaving through the gap. */
export const SignOutIcon = make('sign-out', (a) => (
  <>
    <path d={arc([10.4, 12, 7.6], 40, 320)} />
    <path d="M7.6 12h9.2" />
    {disc([19.2, 12, 2.6], a)}
  </>
));

export const PrintIcon = make('print', (a) => (
  <>
    <path d="M7.4 8V5.2a1.4 1.4 0 0 1 1.4-1.4h6.4a1.4 1.4 0 0 1 1.4 1.4V8" />
    <rect x="3" y="8" width="18" height="9" rx="4.5" />
    <rect x="7.4" y="13.6" width="9.2" height="7" rx="1.2" fill="var(--surface, #fff)" />
    {disc([16.8, 11.2, 1.3], a)}
  </>
));

/** A person and a coloured disc with a plus: invite someone. */
export const InviteIcon = make('invite', (a) => (
  <>
    {ring([9, 8, 3.5])}
    <path d="M3 19.5c.6-3.4 3-5.5 6-5.5s5.4 2.1 6 5.5" />
    {disc([18.4, 9, 3.8], a)}
    <path d="M18.4 7.2v3.6M16.6 9h3.6" {...WHITE} />
  </>
));

/** Someone taken off: the person, and a red disc with a minus. */
export const RemovePersonIcon = make('remove-person', (a) => (
  <>
    {ring([9, 8, 3.5])}
    <path d="M3 19.5c.6-3.4 3-5.5 6-5.5s5.4 2.1 6 5.5" />
    {disc([18.4, 9, 3.8], a)}
    <path d="M16.6 9h3.6" {...WHITE} />
  </>
));

/** A coloured disc on its way, leaving a trail of smaller rings. */
export const SendIcon = make('send', (a) => (
  <>
    {ring([3.6, 12, 1.4])}
    {ring([8.4, 12, 2.4])}
    {disc([16.4, 12, 5], a)}
    <path d="M15.4 9.6l2.4 2.4-2.4 2.4" {...WHITE} />
  </>
));

/** A ring being written: lines of text inside, the pen's coloured disc where the ring is still open. */
export const ComposeIcon = make('compose', (a) => (
  <>
    <path d={arc([12, 12, 8.4], -50, 240)} />
    <path d="M8.2 10.6h7.6M8.2 14h4.6" />
    {disc([17.4, 5.6, 2.6], a)}
  </>
));

/** A round lock: the shackle an arc, the keyhole a coloured disc. */
export const PrivateIcon = make('private', (a) => (
  <>
    <path d="M8.4 10.2V8a3.6 3.6 0 0 1 7.2 0v2.2" />
    {ring([12, 15, 6])}
    {disc([12, 15, 2.2], a)}
  </>
));

export const UnlockedIcon = make('unlocked', (a) => (
  <>
    <path d="M8.4 10.2V7.4a3.6 3.6 0 0 1 6.9-1.4" />
    {ring([12, 15, 6])}
    {disc([12, 15, 2.2], a)}
  </>
));

/** An eye is the petal itself, with a coloured disc for the pupil. */
const LID_TOP: Circle = [12, 17.4, 11];
const LID_BOTTOM: Circle = [12, 6.6, 11];
export const VisibleIcon = make('visible', (a) => (
  <>
    <path d={petal(LID_TOP, LID_BOTTOM)} />
    {disc([12, 12, 3], a)}
  </>
));

export const HiddenIcon = make('hidden', (a) => (
  <>
    <path d={petal(LID_TOP, LID_BOTTOM)} />
    {disc([12, 12, 3], a)}
    <path d="M5.4 18.6L18.6 5.4" stroke="var(--surface, #fff)" strokeWidth="3.2" />
    <path d="M5.4 18.6L18.6 5.4" />
  </>
));

/** A cloud of overlapping rings with a coloured tick disc: saved. */
const CLOUD = 'M7.2 18.6a4.2 4.2 0 0 1-.6-8.4 5.6 5.6 0 0 1 10.8 1 3.8 3.8 0 0 1 .2 7.4z';
export const SavedIcon = make('saved', (a) => (
  <>
    <path d={CLOUD} />
    {disc([17.6, 17, 4], a)}
    <path d="M15.8 17l1.3 1.3 2.4-2.6" {...WHITE} />
  </>
));

export const OfflineIcon = make('offline', (a) => (
  <>
    <path d={CLOUD} />
    {disc([17.6, 17, 4], a)}
    <path d="M16.2 15.6l2.8 2.8M19 15.6l-2.8 2.8" {...WHITE} />
  </>
));

/** A ring of petals around a coloured disc with a tick: checked and genuine. */
export const VerifiedIcon = make('verified', (a) => (
  <>
    <path d="M12 2.8l2.3 1.7 2.8-.2.9 2.7 2.4 1.5-.9 2.7.9 2.7-2.4 1.5-.9 2.7-2.8-.2L12 21.2l-2.3-1.7-2.8.2-.9-2.7-2.4-1.5.9-2.7-.9-2.7 2.4-1.5.9-2.7 2.8.2z" />
    {disc([12, 12, 5], a)}
    <path d="M9.8 12l1.5 1.5 3-3.1" {...WHITE} />
  </>
));

/** A coloured disc inside a ring, with a mark: look here. */
export const WarningIcon = make('warning', (a) => (
  <>
    {ring([12, 12, 9])}
    {disc([12, 12, 6], a)}
    <path d="M12 8.8v3.6" {...WHITE} strokeWidth="2" />
    <circle cx="12" cy="15.2" r="1.1" fill="#fff" stroke="none" />
  </>
));

/** A clip bent from rings, holding a coloured disc. */
export const AttachIcon = make('attach', (a) => (
  <>
    <path d="M16 9.4v6.2a4 4 0 0 1-8 0V6.8a2.6 2.6 0 0 1 5.2 0v8.4a1.2 1.2 0 0 1-2.4 0V9" />
    {disc([18.6, 5.4, 2.4], a)}
  </>
));

/** Play, inside a ring: present full screen. */
export const PresentIcon = make('present', (a) => (
  <>
    {ring([12, 12, 9])}
    <path d="M10 8.2v7.6l6-3.8z" fill={a} stroke={a} strokeWidth="1.4" />
  </>
));

/** A ring left open at the corner, a coloured disc heading out: opens somewhere else. */
export const OpenIcon = make('open', (a) => (
  <>
    <path d={arc([10.6, 13.4, 7.6], -15, 285)} />
    <path d="M10.6 13.4l6.6-6.6" />
    {disc([18.4, 5.6, 2.6], a)}
  </>
));
