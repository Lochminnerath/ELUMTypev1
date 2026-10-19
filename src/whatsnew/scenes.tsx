import { useId, type ReactNode } from 'react';

/** The animated pictures at the top of each What's new step, drawn with the ELUM glass discs. */
export type Art = 'mark' | 'share' | 'devices' | 'layers' | 'check' | 'spark';

interface SceneProps {
  art: Art;
  /** The app's mark, shown large on the opening step. */
  mark: ReactNode;
}

export function Scene({ art, mark }: SceneProps) {
  const id = useId().replace(/:/g, '');
  const glass = `url(#${id}-glass)`;
  const defs = (
    <defs>
      <radialGradient id={`${id}-glass`} cx="35%" cy="28%" r="85%">
        <stop offset="0" className="wn-glass-hi" />
        <stop offset="1" className="wn-glass-lo" />
      </radialGradient>
    </defs>
  );

  if (art === 'mark') {
    return (
      <div className="wn-scene wn-scene--mark">
        <svg className="wn-scene__svg" viewBox="0 0 560 240" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <circle key={i} className="wn-ripple" style={{ animationDelay: `${i * 0.9}s` }} cx="280" cy="120" r="70" />
          ))}
        </svg>
        <div className="wn-mark">{mark}</div>
      </div>
    );
  }

  if (art === 'share') {
    return (
      <svg className="wn-scene wn-scene__svg" viewBox="0 0 560 240" aria-hidden="true">
        {defs}
        <circle className="wn-disc wn-from-left" cx="240" cy="124" r="64" fill={glass} />
        <circle className="wn-disc wn-from-right" cx="320" cy="124" r="64" fill={glass} />
        <path className="wn-accent wn-fade" style={{ animationDelay: '0.75s' }} d="M280 74A64 64 0 0 1 280 174A64 64 0 0 1 280 74Z" />
        <g className="wn-fly" style={{ animationDelay: '1.1s' }}>
          <circle className="wn-accent wn-bob" cx="404" cy="58" r="11" />
        </g>
      </svg>
    );
  }

  if (art === 'devices') {
    return (
      <svg className="wn-scene wn-scene__svg" viewBox="0 0 560 240" aria-hidden="true">
        {defs}
        <g className="wn-rise">
          <rect className="wn-disc" x="128" y="48" width="208" height="132" rx="18" fill={glass} />
          <path className="wn-line" d="M104 196H360" />
        </g>
        <g className="wn-rise" style={{ animationDelay: '0.15s' }}>
          <rect className="wn-disc" x="372" y="70" width="80" height="134" rx="18" fill={glass} />
        </g>
        <circle className="wn-accent wn-ghost" cx="232" cy="114" r="22" />
        <circle className="wn-accent wn-ghost" style={{ animationDelay: '1.6s' }} cx="412" cy="137" r="16" />
        <circle className="wn-accent wn-hop" cx="232" cy="114" r="22" />
      </svg>
    );
  }

  if (art === 'layers') {
    const card = (cls: string, delay: number) => (
      <g className={cls} style={{ animationDelay: `${delay}s` }}>
        <rect className="wn-disc" x="200" y="56" width="160" height="116" rx="18" fill={glass} />
        <circle className="wn-accent" cx="236" cy="92" r="14" />
        <path className="wn-line" d="M262 88H330M262 102H310M222 140H300" />
      </g>
    );
    return (
      <svg className="wn-scene wn-scene__svg" viewBox="0 0 560 240" aria-hidden="true">
        {defs}
        {card('wn-fan wn-fan--left', 0.2)}
        {card('wn-fan wn-fan--right', 0.2)}
        {card('wn-rise', 0)}
      </svg>
    );
  }

  if (art === 'check') {
    return (
      <svg className="wn-scene wn-scene__svg" viewBox="0 0 560 240" aria-hidden="true">
        {defs}
        <circle className="wn-ripple" cx="280" cy="120" r="74" />
        <circle className="wn-disc wn-pop" cx="280" cy="120" r="74" fill={glass} />
        <path className="wn-check" d="M248 122l22 22 44-48" />
      </svg>
    );
  }

  // spark: discs scatter out from the centre and drift back, like confetti made of ELUM.
  const bits = [
    [-150, -60, 14], [-110, 50, 10], [-60, -80, 8], [40, -86, 12], [120, -40, 9], [150, 56, 15], [70, 74, 8], [-30, 84, 11],
  ];
  return (
    <svg className="wn-scene wn-scene__svg" viewBox="0 0 560 240" aria-hidden="true">
      {defs}
      {bits.map(([x, y, r], i) => (
        <circle
          key={i}
          className={i % 3 === 0 ? 'wn-accent wn-burst' : 'wn-disc wn-burst'}
          fill={i % 3 === 0 ? undefined : glass}
          style={{ ['--x' as string]: `${x}px`, ['--y' as string]: `${y}px`, animationDelay: `${0.1 + i * 0.05}s` }}
          cx={280 + x}
          cy={120 + y}
          r={r}
        />
      ))}
      <circle className="wn-disc wn-pop" cx="262" cy="120" r="40" fill={glass} />
      <circle className="wn-disc wn-pop" style={{ animationDelay: '0.1s' }} cx="298" cy="120" r="40" fill={glass} />
      <path className="wn-accent wn-fade" style={{ animationDelay: '0.45s' }} d="M280 84.3A40 40 0 0 1 280 155.7A40 40 0 0 1 280 84.3Z" />
    </svg>
  );
}
