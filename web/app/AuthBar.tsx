"use client";

// Signed-in user menu shown in the header: avatar + dropdown with the user's
// identity, a shortcut to their favorites, and sign-out. The signed-out
// "Sign in" affordance lives in Header.tsx (links to /login).

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAuth } from "./lib/AuthProvider";
import Icon from "./components/Icon";

function initials(name: string | null, email: string | null): string {
  const src = (name || email || "?").trim();
  const parts = src.split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}

export default function UserMenu() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!user) return null;

  return (
    <div className="niq-usermenu" ref={ref}>
      <button
        className="niq-avatar"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="niq-avatar-circle">{initials(user.displayName, user.email)}</span>
        <span className="niq-avatar-name">{user.displayName ?? user.email}</span>
        <Icon name="chevron-down" size={15} style={{ color: "var(--ink-muted)" }} />
      </button>

      {open && (
        <div className="niq-menu-pop" role="menu">
          <div className="niq-menu-head">
            <div className="nm-name">{user.displayName ?? "Signed in"}</div>
            <div className="nm-email">{user.email}</div>
          </div>
          <Link
            href="/#favorites"
            className="niq-menu-item"
            role="menuitem"
            onClick={() => setOpen(false)}
          >
            <Icon name="star" size={16} />
            Your favorites
          </Link>
          <button
            className="niq-menu-item"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              logout();
            }}
          >
            <Icon name="logout" size={16} />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
