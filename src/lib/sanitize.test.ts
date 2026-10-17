import { describe, expect, it } from 'vitest';
import { cleanEmailHtml, cleanRichText, emailDocument, htmlToText, linkify } from './sanitize';

describe('received email', () => {
  it('never keeps scripts or handlers', () => {
    const { html } = cleanEmailHtml('<p onclick="x()">Hi</p><script>alert(1)</script><iframe src="https://x"></iframe><form><input></form>', false);
    expect(html).toBe('<p>Hi</p>');
  });
  it('blocks remote images until allowed', () => {
    const raw = '<img src="https://track.example/p.gif"><div style="background:url(https://track.example/b.png)">x</div><img src="data:image/png;base64,AA==">';
    const blocked = cleanEmailHtml(raw, false);
    expect(blocked.blockedImages).toBe(2);
    expect(blocked.html).not.toContain('track.example');
    expect(blocked.html).toContain('data:image/png');
    const allowed = cleanEmailHtml(raw, true);
    expect(allowed.html).toContain('https://track.example/p.gif');
  });
  it('makes links safe', () => {
    const { html } = cleanEmailHtml('<a href="javascript:alert(1)">a</a><a href="https://ok.example">b</a>', false);
    expect(html).not.toContain('javascript');
    expect(html).toContain('rel="noopener noreferrer nofollow"');
  });
  it('is framed with a strict policy', () => {
    const doc = emailDocument('<p>x</p>', { allowImages: false, dark: false });
    expect(doc).toContain("default-src 'none'");
    expect(doc).toContain('img-src data: cid:;');
    expect(doc).not.toContain('script-src');
  });
});

describe('composer text', () => {
  it('keeps only basic formatting', () => {
    expect(cleanRichText('<b>a</b><span style="color:red">b</span><img src=x onerror=alert(1)>')).toBe('<b>a</b>b');
  });
  it('turns into plain text', () => {
    expect(htmlToText('<p>Hello</p><ul><li>one</li><li>two</li></ul><p><a href="https://x.example">site</a></p>')).toBe(
      'Hello\n- one\n- two\nsite (https://x.example)',
    );
  });
  it('links plain text safely', () => {
    expect(linkify('see https://x.example/a?b=1&c=2. <b>')).toBe(
      'see <a href="https://x.example/a?b=1&amp;c=2" target="_blank" rel="noopener noreferrer nofollow">https://x.example/a?b=1&amp;c=2</a>. &lt;b&gt;',
    );
  });
});
