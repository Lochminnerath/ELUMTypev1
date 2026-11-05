import { VerifiedIcon } from '../components/icons/ElumIcons';

/** ELUM Support's picture: the ELUM mark, with the verified badge in its corner. */
export function ElumSupportMark({ size = 40 }: { size?: number }) {
  return (
    <span className="support-mark" style={{ width: size, height: size }} aria-hidden="true">
      <img className="theme-light-only" src="/brand/logos/elum-mark.svg" alt="" width={Math.round(size * 0.92)} height={Math.round(size * 0.92)} />
      <img className="theme-dark-only" src="/brand/logos/elum-mark-reversed.svg" alt="" width={Math.round(size * 0.92)} height={Math.round(size * 0.92)} />
      <VerifiedIcon className="support-mark__badge" size={Math.max(12, Math.round(size * 0.38))} strokeWidth={2} />
    </span>
  );
}

/** "ELUM Support" with its verified badge, for names and headings. */
export function ElumSupportName({ as: Tag = 'span' }: { as?: 'span' | 'h2' }) {
  return (
    <Tag className="support-name">
      ELUM Support
      <VerifiedIcon className="support-name__badge" size={15} strokeWidth={2} aria-label="Verified by ELUM" />
    </Tag>
  );
}
