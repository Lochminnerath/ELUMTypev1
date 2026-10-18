import { BrowserRouter, Link, Route, Routes } from 'react-router';
import { AuthProvider } from './auth/AuthProvider';
import { RedirectIfSignedIn, RequireAuth } from './auth/guards';
import { TypeMark } from './components/Brand';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ToastProvider } from './components/Toast';
import { TooltipLayer } from './components/TooltipLayer';
import { InboxPage } from './inbox/InboxPage';
import { AuthPage } from './pages/AuthPage';
import { HandoffPage } from './pages/HandoffPage';
import { ContactsPage } from './pages/ContactsPage';
import { SettingsPage } from './pages/SettingsPage';
import { Shell } from './shell/Shell';
import { TypeProvider } from './state/TypeProvider';
import { ThemeProvider } from './theme/ThemeProvider';

function SignedIn({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuth>
      <TypeProvider>
        <Shell>{children}</Shell>
      </TypeProvider>
    </RequireAuth>
  );
}

export function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <AuthProvider>
          <BrowserRouter>
            <ErrorBoundary>
              <Routes>
                <Route path="/signin" element={<RedirectIfSignedIn><AuthPage mode="signin" /></RedirectIfSignedIn>} />
                <Route path="/signup" element={<RedirectIfSignedIn><AuthPage mode="signup" /></RedirectIfSignedIn>} />
                <Route path="/auth/handoff" element={<HandoffPage />} />
                <Route path="/" element={<SignedIn><InboxPage /></SignedIn>} />
                <Route path="/view/:view" element={<SignedIn><InboxPage /></SignedIn>} />
                <Route path="/t/:threadId" element={<SignedIn><InboxPage /></SignedIn>} />
                <Route path="/contacts" element={<SignedIn><ContactsPage /></SignedIn>} />
                <Route path="/settings" element={<SignedIn><SettingsPage /></SignedIn>} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </ErrorBoundary>
          </BrowserRouter>
          <TooltipLayer />
        </AuthProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}

function NotFound() {
  return (
    <div className="empty-state" style={{ minHeight: '100%', justifyContent: 'center' }}>
      <TypeMark size={72} />
      <h2>We could not find that page</h2>
      <p>The link may be wrong, or the page may have moved.</p>
      <Link to="/" className="elum-btn elum-btn--primary">
        Go to your inbox
      </Link>
    </div>
  );
}
