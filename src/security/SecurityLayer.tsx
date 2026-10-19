import type { SupabaseClient } from '@supabase/supabase-js';
import { api } from '../api';
import { useAuth } from '../auth/AuthProvider';
import { ACCOUNT_HOME } from '../lib/elum';
import { ApprovalWait } from './ApprovalWait';
import { SignInPrompt } from './SignInPrompt';

const sb = api.mode === 'remote' ? (api as unknown as { sb: SupabaseClient }).sb : null;
const SECURITY_URL = `${ACCOUNT_HOME}/security`;

/** Sign-in approvals: the waiting screen on a new device, and "Is this you?" on signed-in ones. */
export function SecurityLayer() {
  const { status } = useAuth();
  if (!sb) return null;
  if (status === 'approval') return <ApprovalWait sb={sb} />;
  if (status === 'signed-in') return <SignInPrompt sb={sb} securityUrl={SECURITY_URL} />;
  return null;
}
