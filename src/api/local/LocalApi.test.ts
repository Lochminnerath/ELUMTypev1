import { describe, expect, it } from 'vitest';
import type { DraftInput } from '../types';
import { LocalApi } from './LocalApi';

const fast = () => new LocalApi({ storage: localStorage, passwordIterations: 1, simulateDelay: 0 });

function message(mailboxId: string, to: string[], text: string, extra: Partial<DraftInput> = {}): DraftInput {
  return { id: crypto.randomUUID(), mailboxId, threadId: null, to: to.map((address) => ({ address })), cc: [], bcc: [], subject: '', text, html: null, ...extra };
}

async function account(api: LocalApi, handle: string) {
  await api.signUp({ kind: 'type', handle, name: handle.toUpperCase(), password: 'password1' });
  return (await api.start()).mailboxes[0];
}

describe('LocalApi', () => {
  it('delivers ELUM messages at once, with a notification', async () => {
    const api = fast();
    const ada = await account(api, 'ada');
    expect(ada.canEmail).toBe(true);
    const bo = await account(api, 'bob');
    const sent = await api.send(message(bo.id, ['ada@type.elum.services'], 'Hi Ada'));
    expect(sent.status).toBe('sent');
    expect(await api.send(message(bo.id, ['x'], 'again', { id: sent.messageId }))).toEqual(sent);

    await api.signIn({ login: 'ada', password: 'password1' });
    const inbox = await api.listThreads({ view: 'elum' });
    const thread = inbox.find((t) => t.id === sent.threadId)!;
    expect(thread.unread).toBe(true);
    expect((await api.notifications.list()).some((n) => n.title === 'BOB sent you a message')).toBe(true);
    await api.markRead(thread.id);
    expect((await api.listThreads({ view: 'unread' })).some((t) => t.id === thread.id)).toBe(false);
  });

  it('keeps a Bcc private', async () => {
    const api = fast();
    await account(api, 'ada');
    await account(api, 'cyd');
    const bo = await account(api, 'bob');
    const sent = await api.send(message(bo.id, ['ada@type.elum.services'], 'Plan', { bcc: [{ address: 'cyd@type.elum.services' }] }));
    expect((await api.getThread(sent.threadId)).messages[0].bcc.map((b) => b.address)).toEqual(['cyd@type.elum.services']);
    await api.signIn({ login: 'ada', password: 'password1' });
    const seen = await api.getThread(sent.threadId);
    expect(seen.messages[0].bcc).toEqual([]);
    expect(seen.participants.some((p) => p.address === 'cyd@type.elum.services')).toBe(false);
    await api.signIn({ login: 'cyd', password: 'password1' });
    expect((await api.getThread(sent.threadId)).messages).toHaveLength(1);
  });

  it('lets external accounts message ELUM people but not email outside', async () => {
    const api = fast();
    await account(api, 'ada');
    await api.signUp({ kind: 'external', name: 'Oli', email: 'oli@example.org', password: 'password1' });
    const ola = (await api.start()).mailboxes[0];
    expect(ola.canEmail).toBe(false);
    await expect(api.send(message(ola.id, ['kai@outside.example'], 'hi'))).rejects.toMatchObject({ code: 'forbidden' });
    await expect(api.send(message(ola.id, ['ada@type.elum.services'], 'hi'))).resolves.toMatchObject({ status: 'sent' });
  });

  it('sends outside email and threads the reply', async () => {
    const api = fast();
    const ada = await account(api, 'ada');
    const sent = await api.send(message(ada.id, ['kai@studio.example'], 'Proofs?', { subject: 'Proofs' }));
    expect(sent.status).toBe('queued');
    const thread = await api.getThread(sent.threadId);
    expect(thread.kind).toBe('email');
    expect(thread.messages[0].status).toBe('delivered');
    expect(thread.messages[1].from.address).toBe('kai@studio.example');
  });

  it('checks draft versions', async () => {
    const api = fast();
    const ada = await account(api, 'ada');
    const draft = message(ada.id, [], 'Hel');
    expect((await api.saveDraft(draft, 0)).version).toBe(1);
    await expect(api.saveDraft({ ...draft, text: 'Hello' }, 0)).rejects.toMatchObject({ code: 'conflict', details: { version: 1 } });
    expect((await api.saveDraft({ ...draft, text: 'Hello' }, 1)).version).toBe(2);
  });

  it('answers with a vacation reply once', async () => {
    const api = fast();
    const ada = await account(api, 'ada');
    const sent = await api.send(message(ada.id, ['rae@type.elum.services'], 'Are you around?'));
    await api.send(message(ada.id, ['rae@type.elum.services'], 'Hello?', { threadId: sent.threadId }));
    const auto = (await api.getThread(sent.threadId)).messages.filter((m) => m.auto);
    expect(auto).toHaveLength(1);
  });

  it('refuses taken and reserved handles', async () => {
    const api = fast();
    expect(await api.handleAvailable('fen')).toBe(false);
    expect(await api.handleAvailable('support')).toBe(false);
    expect(await api.handleAvailable('newname')).toBe(true);
  });
});
