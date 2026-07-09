"use client";

import Link from "next/link";
import { useAuth } from "../lib/AuthProvider";
import UserMenu from "../AuthBar";
import Logo from "./Logo";

export default function Header() {
  const { user, loading } = useAuth();

  return (
    <header className="niq-header">
      <div className="niq-header-inner">
        <Link
          href={user ? "/dashboard" : "/"}
          className="niq-brand"
          aria-label="NeighborhoodIQ home"
        >
          <Logo size={28} />
          <span className="niq-wordmark">
            Neighborhood<span>IQ</span>
          </span>
        </Link>

        <div className="niq-header-spacer" />

        <div className="niq-header-actions">
          {!loading &&
            (user ? (
              <UserMenu />
            ) : (
              <Link href="/login" className="niq-btn niq-btn--sm">
                Sign in
              </Link>
            ))}
        </div>
      </div>
    </header>
  );
}
