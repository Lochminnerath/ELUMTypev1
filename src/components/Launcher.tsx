import type { CSSProperties, KeyboardEvent, MouseEvent } from 'react';
import { ALWAYS_THERE, storePage, type ElumApp, type ElumAppId } from '../lib/platform';
import { Popover } from './Popover';
import './Launcher.css';

/**
 * The ELUM launcher: a small window of round app tiles, opened from the top bar, for moving
 * between ELUM apps. The same component lives in every app. Apps the person has not added yet open
 * their page in ELUM Store, where Get adds them.
 */
export type LauncherApp = ElumApp;

interface LauncherProps {
  apps: LauncherApp[];
  /** The app this is. Its tile is marked and does not navigate. */
  current: ElumAppId;
  /** The apps on this account (null while unknown, or signed out: then every tile just opens). */
  added?: string[] | null;
  /** Opens another app (signed in where the app can). Plain left clicks only; others follow the link. */
  onOpen(url: string): void;
}

export function Launcher({ apps, current, added, onOpen }: LauncherProps) {
  // Arrow keys move between tiles, three to a row.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const tiles = [...e.currentTarget.querySelectorAll<HTMLElement>('.launcher__tile:not([aria-disabled])')];
    const at = tiles.indexOf(document.activeElement as HTMLElement);
    if (at < 0) return;
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 3, ArrowUp: -3 }[e.key];
    if (!step) return;
    e.preventDefault();
    tiles[Math.min(tiles.length - 1, Math.max(0, at + step))]?.focus();
  };

  return (
    <Popover
      label="ELUM apps"
      placement="bottom-end"
      className="launcher"
      trigger={(props) => (
        <button type="button" className="icon-btn icon-btn--round launcher__trigger" aria-label="ELUM apps" data-tip="ELUM apps" {...props}>
          <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
            {[4, 10, 16].flatMap((y) => [4, 10, 16].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="2.1" fill="currentColor" />))}
          </svg>
        </button>
      )}
    >
      {(close) => (
        <div className="launcher__window" onKeyDown={onKeyDown}>
          <div className="launcher__head">
            <img className="theme-light-only" src="/brand/logos/elum-lockup-horizontal.svg" height={18} alt="ELUM" />
            <img className="theme-dark-only" src="/brand/logos/elum-lockup-horizontal-reversed.svg" height={18} alt="ELUM" />
            <span className="launcher__tagline">Made by you. Runs without AI.</span>
          </div>
          <ul className="launcher__grid">
            {apps.map((app, i) => {
              const here = app.id === current;
              const get = !here && !!added && !ALWAYS_THERE.includes(app.id) && !added.includes(app.id);
              const url = get ? storePage(app.id) : app.url;
              const style = { '--app': app.color, '--i': i } as CSSProperties;
              const face = (
                <>
                  <span className="launcher__disc">
                    <img className="theme-light-only" src={`/brand/apps/${app.id}.svg`} alt="" />
                    <img className="theme-dark-only" src={`/brand/apps/${app.id}-reversed.svg`} alt="" />
                  </span>
                  <span className="launcher__name">{app.name}</span>
                  <span className="launcher__note">{here ? 'Open now' : get ? 'Get in Store' : app.note}</span>
                </>
              );
              return (
                <li key={app.id} style={style}>
                  {here ? (
                    <span className="launcher__tile" data-here aria-current="page" tabIndex={0} onClick={close}>
                      {face}
                    </span>
                  ) : (
                    <a
                      className="launcher__tile"
                      href={url}
                      data-get={get || undefined}
                      aria-label={get ? `${app.name}: get it in ELUM Store` : undefined}
                      onClick={(e: MouseEvent<HTMLAnchorElement>) => {
                        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                        e.preventDefault();
                        close();
                        onOpen(url);
                      }}
                    >
                      {face}
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Popover>
  );
}
