// Inline SVG icon set (Lucide-style, 24x24 viewBox, currentColor).
// Replaces emoji used as UI icons. Icon-only buttons must supply their own
// aria-label; decorative icons are aria-hidden by default.

import type { SVGProps } from "react";

export type IconName =
  | "search"
  | "arrow-right"
  | "wallet"
  | "trending-up"
  | "zap"
  | "refresh"
  | "star"
  | "star-filled"
  | "sun"
  | "moon"
  | "mail"
  | "lock"
  | "eye"
  | "eye-off"
  | "check"
  | "chevron-down"
  | "sparkles"
  | "logout"
  | "send"
  | "house"
  | "alert";

const PATHS: Record<Exclude<IconName, "star-filled" | "google">, string> = {
  search: "M11 11m-7 0a7 7 0 1 0 14 0a7 7 0 1 0-14 0 M21 21l-4.3-4.3",
  "arrow-right": "M5 12h14 M13 6l6 6-6 6",
  wallet:
    "M3 7a2 2 0 0 1 2-2h13a1 1 0 0 1 1 1v3 M3 7v10a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1v-3 M21 11h-5a2 2 0 1 0 0 4h5",
  "trending-up": "M3 17l6-6 4 4 8-8 M21 7h-6 M21 7v6",
  zap: "M13 2L4.5 13.5H11l-1 8.5 8.5-11.5H12l1-8.5z",
  refresh:
    "M3 12a9 9 0 0 1 15-6.7L21 8 M21 3v5h-5 M21 12a9 9 0 0 1-15 6.7L3 16 M3 21v-5h5",
  star: "M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z",
  sun: "M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10z M12 1v2 M12 21v2 M4.2 4.2l1.4 1.4 M18.4 18.4l1.4 1.4 M1 12h2 M21 12h2 M4.2 19.8l1.4-1.4 M18.4 5.6l1.4-1.4",
  moon: "M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z",
  mail: "M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M3 7l9 6 9-6",
  lock: "M5 11h14a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1z M8 11V7a4 4 0 0 1 8 0v4",
  eye: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
  "eye-off":
    "M9.9 4.2A10.4 10.4 0 0 1 12 4c6.5 0 10 7 10 7a18 18 0 0 1-2.3 3.2 M6.6 6.6A18 18 0 0 0 2 11s3.5 7 10 7a10 10 0 0 0 4.4-1 M3 3l18 18 M9.9 9.9a3 3 0 0 0 4.2 4.2",
  check: "M5 12.5l4.5 4.5L19 7",
  "chevron-down": "M6 9l6 6 6-6",
  sparkles:
    "M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6z M19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8z",
  logout: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4 M16 17l5-5-5-5 M21 12H9",
  send: "M22 2L11 13 M22 2l-7 20-4-9-9-4z",
  house: "M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M9 22V12h6v10",
  alert: "M12 3l9 16H3z M12 10v4 M12 17.5v.5",
};

export default function Icon({
  name,
  size = 18,
  strokeWidth = 2,
  ...rest
}: {
  name: IconName;
  size?: number;
  strokeWidth?: number;
} & Omit<SVGProps<SVGSVGElement>, "name">) {
  // Filled star is a solid shape rather than a stroked outline.
  if (name === "star-filled") {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
        {...rest}
      >
        <path d="M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" />
      </svg>
    );
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

// Official multi-color Google "G" mark for the OAuth button.
export function GoogleIcon({ size = 18, ...rest }: { size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" {...rest}>
      <path
        fill="#4285F4"
        d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.8z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6H1.3a12 12 0 0 0 0 10.8z"
      />
      <path
        fill="#EA4335"
        d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1c.9-2.9 3.6-5 6.7-5z"
      />
    </svg>
  );
}
