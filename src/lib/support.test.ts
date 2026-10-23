import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/errors';
import { isSupportable, supportUrl } from './support';

describe('supportUrl', () => {
  it('points at the support form in Browse, with the app', () => {
    expect(supportUrl('write')).toBe('https://browsebyelum.netlify.app/app/inquire/f/support?app=write');
  });

  it('adds the code, message and page, encoded', () => {
    const url = new URL(supportUrl('make', { code: 'send-failed', message: 'We could not send it & more', from: '/a b' }));
    expect(url.searchParams.get('app')).toBe('make');
    expect(url.searchParams.get('code')).toBe('send-failed');
    expect(url.searchParams.get('message')).toBe('We could not send it & more');
    expect(url.searchParams.get('from')).toBe('/a b');
    expect(url.search).not.toContain('+');
  });

  it('trims values and keeps the message to 300 characters', () => {
    const url = new URL(supportUrl('type', { code: '  oops ', message: ` ${'x'.repeat(400)}` }));
    expect(url.searchParams.get('code')).toBe('oops');
    expect(url.searchParams.get('message')).toHaveLength(300);
  });

  it('leaves out empty details', () => {
    expect(supportUrl('store', { code: ' ', message: '' })).toBe('https://browsebyelum.netlify.app/app/inquire/f/support?app=store');
  });
});

describe('isSupportable', () => {
  it('offers support for server, network and unexpected failures only', () => {
    expect(isSupportable(new ApiError('server', 'x'))).toBe(true);
    expect(isSupportable(new ApiError('network', 'x'))).toBe(true);
    expect(isSupportable(new Error('boom'))).toBe(true);
    expect(isSupportable(new ApiError('invalid', 'x'))).toBe(false);
    expect(isSupportable(new ApiError('invalid_credentials', 'x'))).toBe(false);
    expect(isSupportable(new ApiError('conflict', 'x'))).toBe(false);
  });
});
