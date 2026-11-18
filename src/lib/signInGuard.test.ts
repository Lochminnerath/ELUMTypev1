import { describe, expect, it } from 'vitest';
import { guardHtml, guardText, isSignInLink } from './signInGuard';

describe('sign-in links in Type', () => {
  it('knows approval, magic and handoff links', () => {
    expect(isSignInLink('https://accountsbyelum.netlify.app/approve#abc123')).toBe(true);
    expect(isSignInLink('https://deploy-preview-15--accountsbyelum.netlify.app/approve#abc')).toBe(true);
    expect(isSignInLink('https://account.elum.space/approve#x')).toBe(true);
    expect(isSignInLink('https://afdnnvngrpdodsfwpaqo.supabase.co/auth/v1/verify?token=x&type=magiclink')).toBe(true);
    expect(isSignInLink('https://writebyelum.netlify.app/auth/handoff#token_hash=x&next=/')).toBe(true);
    expect(isSignInLink('https://example.com/welcome#access_token=x')).toBe(true);
  });
  it('leaves ordinary links alone', () => {
    expect(isSignInLink('https://accountsbyelum.netlify.app/security')).toBe(false);
    expect(isSignInLink('https://writebyelum.netlify.app/doc/123')).toBe(false);
    expect(isSignInLink('https://example.com/approve')).toBe(false);
    expect(isSignInLink('mailto:a@b.c')).toBe(false);
  });
  it('takes the button out of an approval email and keeps the rest', () => {
    const html = '<p>Hi</p><a href="https://accountsbyelum.netlify.app/approve#tok" style="x">Review this sign-in</a><a href="https://elum.netlify.app/privacy">Privacy</a>';
    const out = guardHtml(html);
    expect(out.removed).toBe(1);
    expect(out.html).not.toContain('approve#tok');
    expect(out.html).toContain('Review this sign-in');
    expect(out.html).toContain('href="https://elum.netlify.app/privacy"');
  });
  it('replaces a sign-in address written as text', () => {
    const out = guardText('Open https://accountsbyelum.netlify.app/approve#tok to review.');
    expect(out.removed).toBe(1);
    expect(out.text).not.toContain('tok');
  });
});
