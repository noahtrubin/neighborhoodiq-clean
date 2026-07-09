"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "../lib/AuthProvider";
import { GoogleIcon } from "../components/Icon";
import Logo from "../components/Logo";

// Only allow internal, single-slash redirect targets; default to the dashboard.
function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/dashboard";
  return raw;
}

export default function AuthForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const { user, signIn } = useAuth();
  const [busy, setBusy] = useState(false);

  // A successful Google sign-in flips `user`; redirect to the target then.
  useEffect(() => {
    if (user) router.replace(next);
  }, [user, next, router]);

  const onGoogle = async () => {
    setBusy(true);
    await signIn();
    // signIn resolves whether or not the popup succeeded; re-enable on cancel.
    setBusy(false);
  };

  return (
    <div className="auth-card">
      <Link href="/" className="niq-brand" aria-label="NeighborhoodIQ home">
        <Logo size={30} />
        <span className="niq-wordmark">
          Neighborhood<span>IQ</span>
        </span>
      </Link>

      <h1>Welcome to NeighborhoodIQ</h1>
      <p className="auth-sub">
        Sign in to open your dashboard, save favorite ZIPs, and keep your AI chats.
      </p>

      <button type="button" className="auth-google" onClick={onGoogle} disabled={busy}>
        <GoogleIcon size={18} />
        {busy ? "Opening Google…" : "Continue with Google"}
      </button>

      <p className="auth-fine">
        We only use your Google account to sign you in. No password to remember.
      </p>

      <div className="auth-foot">
        <Link href="/" className="auth-guest">
          Back to home
        </Link>
      </div>
    </div>
  );
}
