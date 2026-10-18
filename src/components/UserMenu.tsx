import { CircleUser, LogOut, Monitor, Moon, PenLine, Sun } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { api, errorMessage } from '../api';
import { useAuth, useUser } from '../auth/AuthProvider';
import { useTheme } from '../theme/ThemeProvider';
import { Avatar } from './Avatar';
import { Dialog } from './Dialog';
import { Menu } from './Menu';
import { ACCOUNT_URL, accountsSignIn, openAccount } from '../lib/elum';

const ICON = { size: 16, strokeWidth: 1.75 };

export function UserMenu() {
  const user = useUser();
  const { signOut, updateName } = useAuth();
  const { preference, setPreference } = useTheme();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(user.name);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const saveName = async () => {
    setSaving(true);
    setError(null);
    try {
      await updateName(name);
      setEditing(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Menu
        label="Account"
        placement="bottom-end"
        header={
          <div className="user-menu__header">
            <Avatar user={user} size={40} />
            <div>
              <div className="user-menu__name">{user.name}</div>
              <div className="user-menu__email">{user.handle ? `${user.handle}@${api.typeDomain}` : user.email}</div>
            </div>
          </div>
        }
        items={[
          {
            label: 'Appearance',
            icon: <Sun {...ICON} />,
            items: [
              { label: 'Match system', icon: <Monitor {...ICON} />, checked: preference === 'system', onSelect: () => setPreference('system') },
              { label: 'Light', icon: <Sun {...ICON} />, checked: preference === 'light', onSelect: () => setPreference('light') },
              { label: 'Dark', icon: <Moon {...ICON} />, checked: preference === 'dark', onSelect: () => setPreference('dark') },
            ],
          },
          ACCOUNT_URL
            ? {
                label: 'Profile and picture',
                hint: 'In your ELUM account',
                icon: <PenLine {...ICON} />,
                onSelect: () => openAccount('/profile'),
              }
            : {
                label: 'Edit your name',
                icon: <PenLine {...ICON} />,
                onSelect: () => {
                  setName(user.name);
                  setError(null);
                  setEditing(true);
                },
              },
          ...(ACCOUNT_URL
            ? [
                {
                  label: 'Your ELUM account',
                  hint: 'Password, people, privacy, notifications',
                  icon: <CircleUser {...ICON} />,
                  onSelect: () => openAccount('/'),
                },
              ]
            : []),
          'separator',
          {
            label: 'Sign out',
            icon: <LogOut {...ICON} />,
            onSelect: async () => {
              await signOut();
              // Signed in through ELUM Account: sign out there too, then come back.
              if (accountsSignIn) window.location.assign(`${ACCOUNT_URL}/signout?to=${encodeURIComponent(`${location.origin}/`)}`);
              else navigate('/signin', { replace: true });
            },
          },
        ]}
        trigger={(props) => (
          <button type="button" className="user-menu__trigger" aria-label={`Account: ${user.name}`} {...props}>
            <Avatar user={user} size={34} />
          </button>
        )}
      />
      <Dialog
        open={editing}
        onClose={() => setEditing(false)}
        title="Edit your name"
        description="This is how people see you in Type, Write and every ELUM app."
        width={420}
        footer={
          <>
            <button type="button" className="elum-btn elum-btn--secondary" onClick={() => setEditing(false)}>
              Cancel
            </button>
            <button type="submit" form="edit-name" className="elum-btn elum-btn--primary" disabled={saving || !name.trim()}>
              Save
            </button>
          </>
        }
      >
        <form
          id="edit-name"
          className="field"
          onSubmit={(e) => {
            e.preventDefault();
            void saveName();
          }}
        >
          <label htmlFor="edit-name-input">Name</label>
          <input
            id="edit-name-input"
            className="input"
            value={name}
            autoFocus
            maxLength={80}
            aria-invalid={!!error}
            onChange={(e) => setName(e.target.value)}
          />
          {error && <span className="field-error">{error}</span>}
        </form>
      </Dialog>
    </>
  );
}
