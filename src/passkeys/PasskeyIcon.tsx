/** The passkey symbol: a person with a key, drawn from ELUM circles. */
export function PasskeyIcon({ size = 20 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" aria-hidden="true">
      <circle cx="9" cy="7.5" r="3.6" stroke="currentColor" strokeWidth="1.8" />
      <path d="M2.8 19.5c.6-3.4 3.1-5.6 6.2-5.6 1.2 0 2.3.3 3.2.9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="17.5" cy="12.5" r="2.6" stroke="currentColor" strokeWidth="1.8" />
      <path d="M17.5 15.1v5.4M17.5 18.2h1.9M17.5 20.3h1.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
