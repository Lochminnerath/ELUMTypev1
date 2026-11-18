/**
 * Sign-in and confirmation codes in email ("Your code is 482913"), so Type can show the code with
 * a copy button. Plain rules, no guessing by AI: a 4 to 8 digit number, or a 6 to 8 character
 * mix of capitals and digits, close to a word like "code", "verification" or "PIN".
 */
const KEYWORD = /\b(code|codes|verification|verify|passcode|pass code|one[- ]time|otp|pin|security code|confirm|confirmation|sign[- ]?in|log[- ]?in|2fa|two[- ]factor)\b/i;
const CANDIDATE = /(?<![\w./:#-])((?:\d[ -]?){3,7}\d|(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{6,8})(?![\w/:#-]|\.\d)/g;

export function findCode(subject: string | null | undefined, text: string | null | undefined): string | null {
  const hay = `${subject ?? ''}\n${(text ?? '').slice(0, 4000)}`;
  if (!KEYWORD.test(hay)) return null;
  for (const m of hay.matchAll(CANDIDATE)) {
    const raw = m[1];
    const code = raw.replace(/[ -]/g, '');
    if (/^\d+$/.test(code)) {
      if (code.length < 4 || code.length > 8) continue;
      // A year, not a code.
      if (code.length === 4 && /^(19|20)\d\d$/.test(code)) continue;
      // Spaced digits only when they look like a code (482 913), not a phone number.
      if (raw !== code && !/^\d{3,4}[ -]\d{3,4}$/.test(raw)) continue;
    }
    const at = m.index ?? 0;
    const near = hay.slice(Math.max(0, at - 120), at + raw.length + 60);
    if (KEYWORD.test(near)) return code;
  }
  return null;
}
