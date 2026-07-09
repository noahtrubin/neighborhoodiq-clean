import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import Icon from "../components/Icon";
import Logo from "../components/Logo";
import AuthForm from "./AuthForm";

export const metadata: Metadata = {
  title: "Sign in to NeighborhoodIQ",
  description: "Sign in with Google to open your NeighborhoodIQ dashboard.",
};

export default function LoginPage() {
  return (
    <main className="auth-page">
      {/* Brand / marketing panel (hidden under 900px) */}
      <aside className="auth-brand">
        <Link href="/" className="niq-brand" aria-label="NeighborhoodIQ home">
          <Logo size={30} />
          <span className="niq-wordmark">
            Neighborhood<span>IQ</span>
          </span>
        </Link>

        <h2>
          Spot the <span className="grad">next neighborhood</span> before prices move.
        </h2>
        <p>
          Save the ZIP codes you&apos;re watching, keep your AI chats, and pick up
          right where you left off, across every device.
        </p>

        <ul className="auth-features">
          <li>
            <Icon name="star" size={17} />
            Save and track favorite ZIPs
          </li>
          <li>
            <Icon name="zap" size={17} />
            Chat with AI about any neighborhood
          </li>
          <li>
            <Icon name="refresh" size={17} />
            Forecasts refreshed every month
          </li>
        </ul>

        <div className="auth-brand-stats">
          <div className="auth-stat">
            <div className="as-num">26 yrs</div>
            <div className="as-label">of price data</div>
          </div>
          <div className="auth-stat">
            <div className="as-num">20,000+</div>
            <div className="as-label">metro ZIP codes</div>
          </div>
          <div className="auth-stat">
            <div className="as-num">50</div>
            <div className="as-label">states covered</div>
          </div>
        </div>
      </aside>

      {/* Form side */}
      <div className="auth-form-side">
        <Suspense fallback={null}>
          <AuthForm />
        </Suspense>
      </div>
    </main>
  );
}
