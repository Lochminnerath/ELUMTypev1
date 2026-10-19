import type { CSSProperties, KeyboardEvent, MouseEvent } from 'react';
import { Popover } from './Popover';
import './Launcher.css';

/**
 * The ELUM launcher: a small window of round app tiles, opened from the top bar, for moving
 * between ELUM apps. The same component lives in every app; each passes its own list.
 */
export interface LauncherApp {
  id: 'write' | 'type' | 'make' | 'account' | 'browse' | 'store';
  name: string;
  note: string;
  /** Where it opens. Null while it is not open yet ("Soon"). */
  url: string | null;
  /** The app's colour, for its ring. */
  color: string;
}

interface LauncherProps {
  apps: LauncherApp[];
  /** The app this is. Its tile is marked and does not navigate. */
  current: LauncherApp['id'];
  /** Opens another app (signed in where the app can). Plain left clicks only; others follow the link. */
  onOpen(app: LauncherApp): void;
}

export function Launcher({ apps, current, onOpen }: LauncherProps) {
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
            <span className="launcher__tagline">Built by people. Runs without AI.</span>
          </div>
          <ul className="launcher__grid">
            {apps.map((app, i) => {
              const here = app.id === current;
              const soon = !app.url && !here;
              const style = { '--app': app.color, '--i': i } as CSSProperties;
              const face = (
                <>
                  <span className="launcher__disc">
                    <img className="theme-light-only" src={`/brand/apps/${app.id}.svg`} alt="" />
                    <img className="theme-dark-only" src={`/brand/apps/${app.id}-reversed.svg`} alt="" />
                  </span>
                  <span className="launcher__name">{app.name}</span>
                  <span className="launcher__note">{here ? 'Open now' : soon ? 'Soon' : app.note}</span>
                </>
              );
              return (
                <li key={app.id} style={style}>
                  {here || soon ? (
                    <span
                      className="launcher__tile"
                      data-here={here || undefined}
                      aria-disabled={soon || undefined}
                      aria-current={here ? 'page' : undefined}
                      tabIndex={here ? 0 : undefined}
                      onClick={here ? close : undefined}
                    >
                      {face}
                    </span>
                  ) : (
                    <a
                      className="launcher__tile"
                      href={app.url!}
                      onClick={(e: MouseEvent<HTMLAnchorElement>) => {
                        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                        e.preventDefault();
                        close();
                        onOpen(app);
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
