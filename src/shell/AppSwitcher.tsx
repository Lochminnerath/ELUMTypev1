import { LayoutGrid } from 'lucide-react';
import { WRITE_URL } from '../api';
import { ProductGlyph, type Product } from '../components/Brand';
import { Popover } from '../components/Popover';

/** The five ELUM products in brand order. Services that are not open yet are greyed (handoff 9.6). */
const PRODUCTS: { id: Exclude<Product, 'elum'>; name: string; url: string | null; note: string }[] = [
  { id: 'write', name: 'Write', url: WRITE_URL, note: 'Documents' },
  { id: 'type', name: 'Type', url: null, note: 'Messages and email' },
  { id: 'browse', name: 'Browse', url: null, note: 'Coming soon' },
  { id: 'make', name: 'Make', url: null, note: 'Coming soon' },
  { id: 'store', name: 'Store', url: null, note: 'Coming soon' },
];

export function AppSwitcher() {
  return (
    <Popover
      label="ELUM apps"
      placement="bottom-end"
      className="switcher"
      trigger={(props) => (
        <button type="button" className="icon-btn icon-btn--round" aria-label="ELUM apps" data-tip="ELUM apps" {...props}>
          <LayoutGrid size={18} strokeWidth={1.75} />
        </button>
      )}
    >
      {() => (
        <div className="switcher__body">
          <p className="label muted switcher__label">ELUM</p>
          <ul className="switcher__grid">
            {PRODUCTS.map((p) => {
              const here = p.id === 'type';
              const open = here || !!p.url;
              const content = (
                <>
                  <span className="switcher__glyph">
                    <ProductGlyph product={p.id} size={24} />
                  </span>
                  <span className="switcher__name">{p.name}</span>
                  <span className="switcher__note">{here ? 'You are here' : p.note}</span>
                </>
              );
              return (
                <li key={p.id}>
                  {open && !here ? (
                    <a className="switcher__item" href={p.url!} target="_blank" rel="noopener noreferrer">
                      {content}
                    </a>
                  ) : (
                    <span className="switcher__item" data-here={here || undefined} aria-disabled={!open || undefined}>
                      {content}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Popover>
  );
}
