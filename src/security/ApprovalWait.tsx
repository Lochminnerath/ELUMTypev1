import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { mySignIn, type MySignIn } from "./approvals";
import "./Approvals.css";

/**
 * Shown on a new device whose sign-in waits for approval. It shows the number to pick on a device
 * that is already signed in, and carries on by itself once approved.
 */
export function ApprovalWait({ sb }: { sb: SupabaseClient }) {
  const [state, setState] = useState<MySignIn | null>(null);

  useEffect(() => {
    let live = true;
    let timer = 0;
    const check = async () => {
      try {
        const now = await mySignIn(sb);
        if (!live) return;
        setState(now);
        if (now.status === "approved") {
          // A fresh token carries the normal role now.
          await sb.auth.refreshSession();
          window.location.reload();
          return;
        }
        if (now.status === "denied" || now.status === "expired") {
          await sb.auth.signOut({ scope: "local" });
          return;
        }
      } catch {
        // The session may have been ended (denied): sign out here too.
        if (!live) return;
        setState({ status: "denied" });
        await sb.auth.signOut({ scope: "local" });
        return;
      }
      timer = window.setTimeout(check, 3000);
    };
    // Ask ELUM to send "Is this you?" to the person's ELUM app. Sent once per sign-in.
    void sb.functions?.invoke("elum-push", { body: {} }).catch(() => undefined);
    void check();
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [sb]);

  const restart = () => window.location.assign("/signin");
  const cancel = async () => {
    await sb.auth.signOut({ scope: "local" });
    restart();
  };

  if (state?.status === "denied" || state?.status === "expired") {
    const denied = state.status === "denied";
    return (
      <div className="approval">
        <div className="approval__card">
          <span
            className="approval__disc approval__disc--stop"
            aria-hidden="true"
          >
            <svg viewBox="0 0 24 24" width="40" height="40">
              <path
                d="M7 7l10 10M17 7L7 17"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
              />
            </svg>
          </span>
          <h1 className="approval__title">
            {denied
              ? "This sign-in was not approved"
              : "Nobody approved this sign-in in time"}
          </h1>
          <p className="approval__text">
            {denied
              ? "Someone on a device signed in to this account said it was not them. If it was you, sign in again and pick the right number."
              : "The request lasts ten minutes. Sign in again to send a new one."}
          </p>
          <button
            type="button"
            className="elum-btn elum-btn--primary"
            onClick={restart}
          >
            Sign in again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="approval" aria-live="polite">
      <div className="approval__card">
        <p className="approval__eyebrow">Confirm it's you</p>
        <span
          className="approval__disc"
          aria-label={
            state?.code ? `Your number is ${state.code}` : "Getting your number"
          }
        >
          {state?.code ?? ""}
        </span>
        <h1 className="approval__title">
          Approve this sign-in on a device you are already signed in to
        </h1>
        <p className="approval__text">
          Open ELUM Type, ELUM Account or any ELUM app there. When it asks “Is
          this you signing in?”, choose <strong>{state?.code ?? "…"}</strong>.
        </p>
        <p className="approval__hint">
          Your phone or computer on this network will ask you to approve.
        </p>
        <p className="approval__hint">
          No other device? Use “Forgot password” on the sign-in page: the email
          link lets you in.
        </p>
        <span className="approval__waiting">
          <span className="approval__dots" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          Waiting for approval
        </span>
        <button
          type="button"
          className="elum-btn elum-btn--secondary"
          onClick={() => void cancel()}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
