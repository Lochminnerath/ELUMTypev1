import { describe, expect, it } from 'vitest';
import { BUSY_ERROR, GENERIC_ERROR, OFFLINE_ERROR, friendly } from './friendly';

describe('friendly', () => {
  it('keeps the plain messages ELUM writes for people', () => {
    for (const m of ['Enter a valid email address.', 'You can send to up to 50 people at once.', 'Attachments can add up to 25 MB.', 'That sign-in is no longer waiting.', 'Choose “No, it is not me”.'])
      expect(friendly(m)).toBe(m);
  });
  it('never shows the inside of ELUM', () => {
    for (const m of [
      'Make is not set up in this database yet. Run the Make migration (supabase/README.md).',
      'Could not connect to Supabase',
      'relation "type.messages" does not exist',
      'new row violates row-level security policy for table "documents"',
      'UPDATE requires a WHERE clause',
      'JWT expired',
      'PGRST202 Could not find the function public.type_send_message',
      'duplicate key value violates unique constraint "x_pkey"',
      "Cannot read properties of undefined (reading 'id')",
      'Unexpected token < in JSON at position 0',
    ])
      expect(friendly(m)).toBe(GENERIC_ERROR);
  });
  it('says plainly when ELUM cannot be reached or is busy', () => {
    expect(friendly('TypeError: Failed to fetch')).toBe(OFFLINE_ERROR);
    expect(friendly('anything', 'network')).toBe(OFFLINE_ERROR);
    expect(friendly('503 Service Unavailable')).toBe(BUSY_ERROR);
    expect(friendly('canceling statement due to statement timeout')).toBe(BUSY_ERROR);
    expect(friendly('')).toBe(GENERIC_ERROR);
    expect(friendly(null)).toBe(GENERIC_ERROR);
  });
});
