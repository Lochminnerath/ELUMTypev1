import { describe, expect, it } from 'vitest';
import { accountCanSignInAt } from './elum';

describe('signing in through ELUM Account', () => {
  it('happens on the ELUM apps’ own sites, elum.services and this computer', () => {
    for (const origin of ['https://writebyelum.netlify.app', 'https://browsebyelum.netlify.app', 'https://storebyelum.netlify.app', 'https://make.elum.services', 'http://localhost:5173']) {
      expect(accountCanSignInAt(origin), origin).toBe(true);
    }
  });

  it('never happens on deploy previews or other sites, which ELUM Account will not sign in to', () => {
    for (const origin of ['https://deploy-preview-3--browsebyelum.netlify.app', 'https://main--storebyelum.netlify.app', 'https://elum.services.example.com', 'https://example.com']) {
      expect(accountCanSignInAt(origin), origin).toBe(false);
    }
  });
});
