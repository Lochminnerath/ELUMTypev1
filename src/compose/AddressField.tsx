import { AtSign, BadgeCheck, X } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { api, type Address, type Contact } from '../api';
import { displayName, parseAddresses } from '../api/validation';
import { Avatar } from '../components/Avatar';

export interface Recipient extends Address {
  /** Known to be an ELUM account (from contacts or people search). */
  isElum?: boolean;
  color?: string | null;
}

interface AddressFieldProps {
  label: string;
  value: Recipient[];
  onChange: (value: Recipient[]) => void;
  autoFocus?: boolean;
  typeDomain: string;
}

/**
 * To, Cc and Bcc as chips (handoff 8.2). Suggestions come from people you have written with and
 * ELUM people by name; ELUM accounts show their avatar and a verified badge.
 */
export function AddressField({ label, value, onChange, autoFocus, typeDomain }: AddressFieldProps) {
  const [text, setText] = useState('');
  const [suggestions, setSuggestions] = useState<Contact[]>([]);
  const [active, setActive] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const id = useId();
  const listId = `${id}-list`;

  useEffect(() => {
    const q = text.trim();
    if (!q) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    const t = window.setTimeout(() => {
      api.contacts(q).then(
        (list) => {
          if (cancelled) return;
          setSuggestions(list.filter((c) => !value.some((v) => v.address === c.address)).slice(0, 6));
          setActive(0);
        },
        () => undefined,
      );
    }, 150);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [text, value]);

  const add = (items: Recipient[]) => {
    const next = [...value];
    for (const item of items) if (!next.some((v) => v.address === item.address)) next.push(item);
    onChange(next);
  };

  const commit = (raw = text) => {
    if (!raw.trim()) return true;
    const { addresses, rest } = parseAddresses(raw);
    add(addresses.map((a) => ({ ...a, isElum: a.address.endsWith(`@${typeDomain}`) || undefined })));
    setText(rest.join(', '));
    setProblem(rest.length ? `${rest.join(', ')} ${rest.length === 1 ? 'is not an email address' : 'are not email addresses'}.` : null);
    setSuggestions([]);
    return !rest.length;
  };

  const choose = (c: Contact) => {
    add([{ address: c.address, name: c.name, isElum: c.isElum, color: c.color }]);
    setText('');
    setSuggestions([]);
    setProblem(null);
    inputRef.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (suggestions.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      setActive((i) => (i + (e.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length);
    } else if (e.key === 'Enter' || e.key === 'Tab' || e.key === ',' || e.key === ';') {
      if (suggestions.length && (e.key === 'Enter' || e.key === 'Tab') && !text.includes('@')) {
        e.preventDefault();
        choose(suggestions[active]);
      } else if (text.trim()) {
        if (e.key !== 'Tab') e.preventDefault();
        commit();
      }
    } else if (e.key === 'Backspace' && !text && value.length) {
      onChange(value.slice(0, -1));
    } else if (e.key === 'Escape' && suggestions.length) {
      e.stopPropagation();
      setSuggestions([]);
    }
  };

  return (
    <div className="address-field">
      <label htmlFor={id} className="address-field__label">
        {label}
      </label>
      <div className="address-field__box" onClick={() => inputRef.current?.focus()}>
        {value.map((r) => (
          <span key={r.address} className="address-chip" data-elum={r.isElum || undefined} title={r.address}>
            {r.isElum && r.color ? <Avatar user={{ name: displayName(r), color: r.color }} size={20} /> : <AtSign size={14} strokeWidth={2} aria-hidden="true" />}
            <span className="address-chip__name">{r.name || r.address}</span>
            {r.isElum && <BadgeCheck className="address-chip__badge" size={14} strokeWidth={2} aria-label="ELUM account" />}
            <button type="button" className="address-chip__remove" aria-label={`Remove ${r.name || r.address}`} onClick={() => onChange(value.filter((v) => v !== r))}>
              <X size={12} strokeWidth={2.25} />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          id={id}
          className="address-field__input"
          value={text}
          autoFocus={autoFocus}
          autoComplete="off"
          spellCheck={false}
          role="combobox"
          aria-expanded={suggestions.length > 0}
          aria-controls={listId}
          aria-activedescendant={suggestions.length ? `${listId}-${active}` : undefined}
          aria-invalid={problem ? true : undefined}
          onChange={(e) => {
            const v = e.target.value;
            if (/[,;]\s*$/.test(v)) commit(v);
            else setText(v);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => window.setTimeout(() => commit(), 120)}
          onPaste={(e) => {
            const pasted = e.clipboardData.getData('text');
            if (/[,;\n]/.test(pasted)) {
              e.preventDefault();
              commit(text + pasted);
            }
          }}
        />
      </div>
      {suggestions.length > 0 && (
        <ul id={listId} className="address-suggest" role="listbox" aria-label="Suggestions">
          {suggestions.map((c, i) => (
            <li
              key={c.address}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className="address-suggest__item"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(c)}
              onMouseEnter={() => setActive(i)}
            >
              <Avatar user={{ name: displayName(c), color: c.isElum ? c.color : null }} size={28} />
              <span className="address-suggest__text">
                <span className="address-suggest__name">
                  {c.name || c.address}
                  {c.isElum && <BadgeCheck size={14} strokeWidth={2} className="address-chip__badge" aria-label="ELUM account" />}
                </span>
                <span className="address-suggest__address">{c.address}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {problem && <span className="field-error address-field__error">{problem}</span>}
    </div>
  );
}
