import { describe, expect, it } from 'vitest';
import { findCode } from './codes';

describe('findCode', () => {
  it('finds a sign-in code', () => {
    expect(findCode('Your verification code', 'Use 482913 to sign in. It expires in 10 minutes.')).toBe('482913');
    expect(findCode('482913 is your Google verification code', '')).toBe('482913');
    expect(findCode('Confirm your email', 'Your code: 482 913')).toBe('482913');
    expect(findCode('Sign in to Example', 'Enter this code: K7Q2ZX')).toBe('K7Q2ZX');
  });
  it('leaves ordinary mail alone', () => {
    expect(findCode('Lunch on Friday?', 'Shall we meet at 1230 by the station?')).toBeNull();
    expect(findCode('Your order', 'Order 2026 shipped. Call 555 123 4567 with questions.')).toBeNull();
    expect(findCode('Code review', 'I left notes on the 2025 plan.')).toBeNull();
  });
});
