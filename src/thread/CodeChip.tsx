import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { findCode } from '../lib/codes';

/** A sign-in or confirmation code from an email, shown large with a copy button. */
export function CodeChip({ subject, text }: { subject: string | null; text: string }) {
  const code = findCode(subject, text);
  const [copied, setCopied] = useState(false);
  if (!code) return null;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Without clipboard access, the code is still there to select.
    }
  };
  return (
    <div className="code-chip">
      <span className="code-chip__label">Code</span>
      <span className="code-chip__code mono">{code}</span>
      <button type="button" className="elum-btn elum-btn--secondary elum-btn--sm" onClick={() => void copy()} aria-live="polite">
        {copied ? <Check size={14} strokeWidth={2} /> : <Copy size={14} strokeWidth={2} />}
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}
