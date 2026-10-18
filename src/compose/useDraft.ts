import { useCallback, useEffect, useRef, useState } from 'react';
import { api, isApiError, type Attachment, type DraftInput, type SendResult } from '../api';

export type SaveState = 'idle' | 'saving' | 'saved' | 'error' | 'conflict';

const SAVE_DELAY = 800;

const hasContent = (d: DraftInput) => !!(d.text.trim() || d.subject.trim() || d.to.length || d.cc.length || d.bcc.length);

/**
 * A message being written: saved as people type (handoff 8.2), with the version it started from
 * so two devices never overwrite each other silently. The draft id becomes the message id.
 */
export function useDraft(initial: DraftInput, initialVersion = 0, initialAttachments: Attachment[] = []) {
  const [draft, setDraft] = useState<DraftInput>(initial);
  const [attachments, setAttachments] = useState<Attachment[]>(initialAttachments);
  const [state, setState] = useState<SaveState>(initialVersion ? 'saved' : 'idle');
  const [conflictVersion, setConflictVersion] = useState<number | null>(null);
  const version = useRef(initialVersion);
  const latest = useRef(draft);
  const dirty = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const sent = useRef(false);

  latest.current = draft;

  const save: () => Promise<boolean> = useCallback((): Promise<boolean> => {
    window.clearTimeout(timer.current);
    const run = async () => {
      if (sent.current || (!dirty.current && version.current > 0)) return true;
      if (!hasContent(latest.current) && version.current === 0) return true;
      dirty.current = false;
      setState('saving');
      try {
        const result = await api.saveDraft(latest.current, version.current);
        version.current = result.version;
        setState(dirty.current ? 'saving' : 'saved');
        return true;
      } catch (e) {
        if (isApiError(e, 'conflict')) {
          setConflictVersion(typeof e.details?.version === 'number' ? e.details.version : null);
          setState('conflict');
        } else {
          dirty.current = true;
          setState('error');
          timer.current = window.setTimeout(() => void save(), 5000);
        }
        return false;
      }
    };
    const next = chain.current.then(run, run);
    chain.current = next;
    return next;
  }, []);

  const update = useCallback(
    (patch: Partial<DraftInput>) => {
      setDraft((d) => ({ ...d, ...patch }));
      dirty.current = true;
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void save(), SAVE_DELAY);
    },
    [save],
  );

  /** After a conflict: keep what is on this screen, written over the other version. */
  const keepMine = useCallback(() => {
    if (conflictVersion !== null) version.current = conflictVersion;
    setConflictVersion(null);
    dirty.current = true;
    void save();
  }, [conflictVersion, save]);

  /** After a conflict: load the version saved elsewhere. */
  const loadTheirs = useCallback(async () => {
    const theirs = (await api.listDrafts()).find((d) => d.id === latest.current.id);
    setConflictVersion(null);
    if (!theirs) return;
    version.current = theirs.version;
    dirty.current = false;
    setDraft({ ...theirs });
    setAttachments(theirs.attachments);
    setState('saved');
  }, []);

  const attach = useCallback(
    async (files: File[]) => {
      // Files belong to a saved draft, so save first.
      dirty.current = true;
      if (!(await save())) throw new Error('save');
      for (const file of files) {
        const a = await api.attach(latest.current.id, file);
        setAttachments((list) => [...list, a]);
      }
    },
    [save],
  );

  const removeAttachment = useCallback(async (a: Attachment) => {
    setAttachments((list) => list.filter((x) => x.id !== a.id));
    await api.removeAttachment(a.id);
  }, []);

  /** Sends the draft; `patch` is applied last, such as recipients that follow the newest message. */
  const send = useCallback(async (patch: Partial<DraftInput> = {}): Promise<SendResult> => {
    window.clearTimeout(timer.current);
    await chain.current.catch(() => undefined);
    const result = await api.send({ ...latest.current, ...patch });
    sent.current = true;
    return result;
  }, []);

  const discard = useCallback(async () => {
    window.clearTimeout(timer.current);
    sent.current = true;
    await chain.current.catch(() => undefined);
    if (version.current > 0) await api.deleteDraft(latest.current.id);
  }, []);

  // Save what is left when the composer closes.
  useEffect(
    () => () => {
      if (dirty.current && !sent.current) void save();
    },
    [save],
  );

  return { draft, update, attachments, attach, removeAttachment, state, save, send, discard, keepMine, loadTheirs, version };
}
