import GlobeLandingHero from "./components/GlobeLandingHero";

// Public landing page: the scroll-driven globe hero. GlobeLandingHero is a
// self-contained client component — it carries its own nav, ZIP search, metro
// chips, and the pinned globe scene (styles scoped under `.lgh`), so the page
// just renders it. The product lives at /dashboard; sign-in is /login.

export default function Landing() {
  return <GlobeLandingHero />;
}
