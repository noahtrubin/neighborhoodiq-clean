This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Authentication

The app is **public** — anyone can search and view forecasts. Signing in only
unlocks personalization (favorite ZIPs and saved AI chats).

- **Dedicated auth page:** [`/login`](app/login/page.tsx) — split brand/marketing
  panel + a card with **Sign in / Create account** tabs, Google OAuth, and
  email/password (show-hide password, inline validation, friendly Firebase error
  messages, "Forgot password" reset, and "Continue as guest").
- **Auth logic:** [`app/lib/AuthProvider.tsx`](app/lib/AuthProvider.tsx) exposes
  `signIn` (Google), `signInEmail`, `signUpEmail`, `resetPassword`, `logout`, and
  the live-synced favorites.

### ⚠️ One-time manual step: enable Email/Password

Email/password sign-in requires enabling the provider in Firebase (Google is
already enabled). In the [Firebase console](https://console.firebase.google.com):

1. Open project **neighborhoodiq-cb9eb** → **Authentication** → **Sign-in method**.
2. Enable **Email/Password**.

No code or secret changes are needed — the web config in
[`app/lib/firebase-client.ts`](app/lib/firebase-client.ts) is public by design.
Until this is enabled, email sign-up returns `auth/operation-not-allowed`, which
the form surfaces as a clear message.

## Theming

Light/dark theme with a toggle in the header. The theme is stored in
`localStorage`, defaults to the OS preference, and is applied before first paint
by an inline script in [`app/layout.tsx`](app/layout.tsx) (no flash). Tokens live
in [`app/globals.css`](app/globals.css); state is in
[`app/lib/ThemeProvider.tsx`](app/lib/ThemeProvider.tsx).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
