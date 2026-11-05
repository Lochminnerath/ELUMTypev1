import { describe, expect, it } from 'vitest';
import { handleProblem, loginToEmail, parseAddresses, replySubject, safeNext } from './validation';

describe('handles', () => {
  it('match the database rules', () => {
    expect(handleProblem('ada')).toBeNull();
    expect(handleProblem('ada.k_9')).toBeNull();
    expect(handleProblem('ab')).toMatch(/at least 3/);
    expect(handleProblem('a..b')).toMatch(/two symbols/);
    expect(handleProblem('.ada')).toMatch(/Start and end/);
    expect(handleProblem('ada!')).toMatch(/letters, numbers/);
    expect(handleProblem('postmaster')).toMatch(/not available/);
    expect(handleProblem('x'.repeat(31))).toMatch(/at most 30/);
  });
  it('sign in on their own', () => {
    expect(loginToEmail(' Ada ', 'elum.space')).toBe('ada@elum.space');
    expect(loginToEmail('Ada@Example.org', 'elum.space')).toBe('ada@example.org');
  });
});

describe('parseAddresses', () => {
  it('reads names, separators and leftovers', () => {
    const { addresses, rest } = parseAddresses('Rae Reed <RAE@elum.space>, kai@studio.example; not-an-address');
    expect(addresses).toEqual([
      { address: 'rae@elum.space', name: 'Rae Reed' },
      { address: 'kai@studio.example', name: null },
    ]);
    expect(rest).toEqual(['not-an-address']);
  });
});

describe('safeNext', () => {
  it('allows paths and the family domain only', () => {
    expect(safeNext('/t/1')).toBe('/t/1');
    expect(safeNext('//evil.example')).toBe('/');
    expect(safeNext('https://write.elum.space/d/1')).toBe('https://write.elum.space/d/1');
    expect(safeNext('https://elum.space.evil.com/')).toBe('/');
    expect(safeNext('http://write.elum.space/')).toBe('/');
    expect(safeNext('javascript:alert(1)')).toBe('/');
  });
});

it('adds Re: once', () => {
  expect(replySubject('Lunch')).toBe('Re: Lunch');
  expect(replySubject('RE: Lunch')).toBe('RE: Lunch');
});
