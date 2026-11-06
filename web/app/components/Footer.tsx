// Global site footer — rendered once in the root layout so it sits at the
// bottom of every page, edge-aligned with each page's nav. Self-contained
// styles (namespaced under `.site-footer`) so it can't collide with page-scoped
// CSS like the landing's `.lgh` system.
export default function Footer() {
  return (
    <footer className="site-footer">
      <style>{FOOTER_CSS}</style>
      <div className="site-footer-inner">
        <span className="site-footer-brand">NeighborhoodIQ</span>
        <div className="site-footer-links">
          <a
            className="site-footer-link"
            href="https://www.linkedin.com/in/noah-rubin-/"
            target="_blank"
            rel="noopener noreferrer"
          >
            LinkedIn
          </a>
          <a className="site-footer-link" href="mailto:noahtalmirubin@gmail.com">
            noahtalmirubin@gmail.com
          </a>
        </div>
      </div>
    </footer>
  );
}

const FOOTER_CSS = `
.site-footer {
  position: relative; z-index: 5;
  border-top: 1px solid rgba(241,244,238,0.08);
  background: rgba(5,8,16,0.35);
  padding: 22px clamp(20px, 5vw, 48px);
}
.site-footer-inner {
  display: flex; align-items: center; justify-content: space-between;
  gap: 10px 24px; flex-wrap: wrap;
}
.site-footer-brand {
  font-family: var(--font-sans-stack); font-weight: 600; font-size: 14px;
  color: rgba(241,244,238,0.72); letter-spacing: -0.01em;
}
.site-footer-links { display: flex; align-items: center; gap: 8px 20px; flex-wrap: wrap; }
.site-footer-link {
  font-size: 13.5px; line-height: 1.4; color: rgba(241,244,238,0.62);
  text-decoration: none; overflow-wrap: anywhere;
  transition: color 0.15s ease;
}
.site-footer-link:hover { color: rgba(244,246,248,1); }
/* The dashboard is a centred 1200px column (24px inner padding); every other
   page has a full-bleed nav, so the footer spans the same edges as that nav. */
body:has(> .niq-shell) .site-footer-inner { max-width: 1152px; margin: 0 auto; }
@media (max-width: 560px) {
  .site-footer-inner { flex-direction: column; align-items: flex-start; }
  .site-footer-links { flex-direction: column; align-items: flex-start; }
}
`;
