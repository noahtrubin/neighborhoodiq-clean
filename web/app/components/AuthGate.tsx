"use client";

// Reusable authentication gate.
//
//   <AuthGate>{protectedContent}</AuthGate>
//       → renders children only when signed in; otherwise shows an inline
//         sign-in prompt (default) you can customize via title/description/fallback.
//
//   <AuthGate mode="redirect">{protectedPage}</AuthGate>
//       → sends signed-out visitors to /login?next=<current path> (use this to
//         protect a whole route).
//
// While Firebase resolves the session it renders `loadingFallback` (null by
// default) to avoid a flash of the prompt for already-signed-in users.

import { useEffect, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "../lib/AuthProvider";
import Icon, { GoogleIcon } from "./Icon";

export default function AuthGate({
  children,
  mode = "inline",
  title = "Sign in to continue",
  description = "Create a free account or sign in to use this feature.",
  fallback,
  loadingFallback = null,
}: {
  children: ReactNode;
  mode?: "inline" | "redirect";
  title?: string;
  description?: string;
  /** Custom signed-out UI; overrides the default prompt (inline mode only). */
  fallback?: ReactNode;
  /** Shown while the auth state is still resolving. */
  loadingFallback?: ReactNode;
}) {
  const { user, loading, signIn } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const next = encodeURIComponent(pathname || "/");

  useEffect(() => {
    if (mode === "redirect" && !loading && !user) {
      router.replace(`/login?next=${next}`);
    }
  }, [mode, loading, user, next, router]);

  if (loading) return <>{loadingFallback}</>;
  if (user) return <>{children}</>;
  // Redirecting away — render the loading placeholder in the meantime.
  if (mode === "redirect") return <>{loadingFallback}</>;
  if (fallback !== undefined) return <>{fallback}</>;

  return (
    <div className="auth-gate">
      <span className="auth-gate-icon">
        <Icon name="lock" size={20} />
      </span>
      <div className="auth-gate-title">{title}</div>
      <div className="auth-gate-desc">{description}</div>
      <div className="auth-gate-actions">
        <Link href={`/login?next=${next}`} className="niq-btn niq-btn--sm">
          Sign in
        </Link>
        <button type="button" className="auth-google" onClick={() => signIn()}>
          <GoogleIcon size={16} />
          Google
        </button>
      </div>
    </div>
  );
}
