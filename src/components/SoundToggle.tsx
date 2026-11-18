import { useEffect, useState } from 'react';
import { onSoundChange, setSoundOn, soundOn } from '../lib/attention';

/** "Sound on / off" for the notification chime, kept on this device. */
export function SoundToggle() {
  const [on, setOn] = useState(soundOn);
  useEffect(() => onSoundChange(setOn), []);
  return (
    <button
      type="button"
      className="icon-btn icon-btn--round sound-toggle"
      aria-pressed={on}
      aria-label={on ? 'Notification sound on. Turn off' : 'Notification sound off. Turn on'}
      title={on ? 'Sound on' : 'Sound off'}
      onClick={() => setSoundOn(!on)}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M11 5 6 9H3v6h3l5 4V5z" />
        {on ? (
          <>
            <path d="M15.5 8.5a5 5 0 0 1 0 7" />
            <path d="M18.5 5.5a9 9 0 0 1 0 13" />
          </>
        ) : (
          <path d="m16 9 5 6M21 9l-5 6" />
        )}
      </svg>
    </button>
  );
}
