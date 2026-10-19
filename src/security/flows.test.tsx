import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ToastProvider } from '../components/Toast';
import { ApprovalWait } from './ApprovalWait';
import { SignInPrompt } from './SignInPrompt';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));

function fakeClient(rpc: (name: string, args?: Record<string, unknown>) => unknown) {
  return {
    rpc: vi.fn(async (name: string, args?: Record<string, unknown>) => ({ data: rpc(name, args), error: null })),
    auth: { refreshSession: vi.fn(async () => ({})), signOut: vi.fn(async () => ({})) },
  };
}

describe('Is this you signing in?', () => {
  const request = { id: 's1', device: 'Chrome on Windows', ip: '198.51.100.9', at: new Date().toISOString(), expiresAt: '', numbers: [17, 42, 88] };

  it('asks with three numbers and approves with the one picked', async () => {
    const sb = fakeClient((name) => (name === 'elum_sign_in_requests' ? [request] : 'approved'));
    act(() =>
      root.render(
        <ToastProvider>
          <SignInPrompt sb={sb as unknown as SupabaseClient} securityUrl="/security" />
        </ToastProvider>,
      ),
    );
    await flush();
    expect(document.body.textContent).toContain('Is this you signing in?');
    expect(document.body.textContent).toContain('Chrome on Windows');
    const numbers = [...document.querySelectorAll<HTMLButtonElement>('.approval-prompt__number')].map((b) => b.textContent);
    expect(numbers).toEqual(['17', '42', '88']);
    await act(async () => document.querySelectorAll<HTMLButtonElement>('.approval-prompt__number')[1].click());
    expect(sb.rpc).toHaveBeenCalledWith('elum_answer_sign_in', { p_session: 's1', p_number: 42 });
  });

  it('"No, it\'s not me" answers with no number', async () => {
    const sb = fakeClient((name) => (name === 'elum_sign_in_requests' ? [request] : 'denied'));
    act(() =>
      root.render(
        <ToastProvider>
          <SignInPrompt sb={sb as unknown as SupabaseClient} securityUrl="/security" />
        </ToastProvider>,
      ),
    );
    await flush();
    const deny = [...document.querySelectorAll('button')].find((b) => b.textContent === "No, it's not me")!;
    await act(async () => deny.click());
    expect(sb.rpc).toHaveBeenCalledWith('elum_answer_sign_in', { p_session: 's1', p_number: null });
  });

  it('stays quiet when nothing waits', async () => {
    const sb = fakeClient(() => []);
    act(() =>
      root.render(
        <ToastProvider>
          <SignInPrompt sb={sb as unknown as SupabaseClient} securityUrl="/security" />
        </ToastProvider>,
      ),
    );
    await flush();
    expect(document.body.textContent).not.toContain('Is this you');
  });
});

describe('Waiting for approval', () => {
  it('shows the number, then carries on once approved', async () => {
    let status = 'pending';
    const sb = fakeClient(() => ({ status, code: 42 }));
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload, assign: vi.fn() });
    act(() => root.render(<ApprovalWait sb={sb as unknown as SupabaseClient} />));
    await flush();
    expect(host.querySelector('.approval__disc')?.textContent).toBe('42');
    status = 'approved';
    await act(async () => void (await new Promise((r) => setTimeout(r, 3100))));
    expect(sb.auth.refreshSession).toHaveBeenCalled();
    expect(reload).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('signs out and says so when the sign-in was denied', async () => {
    const sb = fakeClient(() => ({ status: 'denied' }));
    act(() => root.render(<ApprovalWait sb={sb as unknown as SupabaseClient} />));
    await flush();
    expect(sb.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(host.textContent).toContain('This sign-in was not approved');
  });
});
