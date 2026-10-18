import { Bold, Italic, Link2, List, ListOrdered } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { cleanRichText, htmlToText } from '../lib/sanitize';

interface RichEditorProps {
  html: string;
  onChange: (value: { html: string; text: string }) => void;
  label: string;
  placeholder?: string;
  onSubmit?: () => void;
  autoFocus?: boolean;
}

const ICON = { size: 16, strokeWidth: 2 };

/**
 * The composer's body: bold, italic, lists and links, nothing more (handoff 8.2). Pasted text
 * arrives plain, and what comes out is cleaned to that short list of tags.
 */
export function RichEditor({ html, onChange, label, placeholder, onSubmit, autoFocus }: RichEditorProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [linking, setLinking] = useState(false);
  const [url, setUrl] = useState('');
  const savedRange = useRef<Range | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (el && el.innerHTML !== html && document.activeElement !== el) el.innerHTML = cleanRichText(html);
  }, [html]);

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  const emit = () => {
    const el = ref.current;
    if (!el) return;
    const clean = cleanRichText(el.innerHTML);
    onChange({ html: clean, text: htmlToText(clean) });
  };

  const run = (command: string, value?: string) => {
    ref.current?.focus();
    document.execCommand(command, false, value);
    emit();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key === 'Enter' && onSubmit) {
      e.preventDefault();
      onSubmit();
    } else if (mod && e.key.toLowerCase() === 'b') {
      e.preventDefault();
      run('bold');
    } else if (mod && e.key.toLowerCase() === 'i') {
      e.preventDefault();
      run('italic');
    } else if (mod && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      startLink();
    }
  };

  const startLink = () => {
    const selection = window.getSelection();
    savedRange.current = selection && selection.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
    setUrl('https://');
    setLinking(true);
  };

  const applyLink = () => {
    setLinking(false);
    const href = url.trim();
    if (!/^(https?:\/\/|mailto:)\S+$/i.test(href)) return;
    ref.current?.focus();
    const selection = window.getSelection();
    if (savedRange.current && selection) {
      selection.removeAllRanges();
      selection.addRange(savedRange.current);
    }
    if (selection && selection.toString()) run('createLink', href);
    else run('insertHTML', `<a href="${href.replace(/"/g, '%22')}">${href.replace(/</g, '&lt;')}</a>`);
  };

  return (
    <div className="rich">
      <div className="rich__tools" role="toolbar" aria-label="Formatting">
        <button type="button" className="icon-btn" aria-label="Bold" data-tip="Bold (Ctrl+B)" onMouseDown={(e) => e.preventDefault()} onClick={() => run('bold')}>
          <Bold {...ICON} />
        </button>
        <button type="button" className="icon-btn" aria-label="Italic" data-tip="Italic (Ctrl+I)" onMouseDown={(e) => e.preventDefault()} onClick={() => run('italic')}>
          <Italic {...ICON} />
        </button>
        <button type="button" className="icon-btn" aria-label="Bulleted list" data-tip="Bulleted list" onMouseDown={(e) => e.preventDefault()} onClick={() => run('insertUnorderedList')}>
          <List {...ICON} />
        </button>
        <button type="button" className="icon-btn" aria-label="Numbered list" data-tip="Numbered list" onMouseDown={(e) => e.preventDefault()} onClick={() => run('insertOrderedList')}>
          <ListOrdered {...ICON} />
        </button>
        <button type="button" className="icon-btn" aria-label="Link" data-tip="Link (Ctrl+K)" onMouseDown={(e) => e.preventDefault()} onClick={startLink}>
          <Link2 {...ICON} />
        </button>
        {linking && (
          <form
            className="rich__link"
            onSubmit={(e) => {
              e.preventDefault();
              applyLink();
            }}
          >
            <input
              className="input input--sm"
              aria-label="Link address"
              value={url}
              autoFocus
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && setLinking(false)}
            />
            <button type="submit" className="elum-btn elum-btn--quiet elum-btn--sm">
              Add
            </button>
          </form>
        )}
      </div>
      <div
        ref={ref}
        className="rich__area"
        contentEditable
        role="textbox"
        aria-multiline="true"
        aria-label={label}
        data-placeholder={placeholder}
        suppressContentEditableWarning
        onInput={emit}
        onKeyDown={onKeyDown}
        onPaste={(e) => {
          e.preventDefault();
          document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
          emit();
        }}
      />
    </div>
  );
}
