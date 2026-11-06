import GlobeLandingHero from "./components/GlobeLandingHero";

// The whole product: the scroll-driven globe. GlobeLandingHero is a
// self-contained client component — it carries its own nav, metro chips, the
// pinned globe scene (styles scoped under `.lgh`), and the floating per-ZIP
// analysis opened by hovering a ZIP, so the page just renders it. Sign-in is
// /login.

export default function Landing() {
  return <GlobeLandingHero />;
}
