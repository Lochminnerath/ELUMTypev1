import { Component, type ReactNode } from 'react';
import { TypeMark } from './Brand';

interface State {
  error: Error | null;
}

/** Shows a calm recovery screen instead of a blank page when something breaks. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    // A new version was released while this tab was open, so a part of the app could not load.
    const stale = /dynamically imported module|Importing a module script failed|Loading chunk/i.test(this.state.error.message);
    return (
      <div className="empty-state" style={{ minHeight: '100%', justifyContent: 'center' }}>
        <TypeMark size={72} />
        <h2>{stale ? 'Type has been updated' : 'Something went wrong'}</h2>
        <p>{stale ? 'Reload to get the latest version. Your messages and drafts are safe.' : 'Reload the page to carry on. Your messages and drafts are safe.'}</p>
        <button type="button" className="elum-btn elum-btn--primary" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    );
  }
}
