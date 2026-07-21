// Global site footer — rendered once in the root layout so it sits at the
// bottom of every page. Self-contained styles (namespaced under `.site-footer`)
// so it can't collide with page-scoped CSS like the landing's `.lgh` system.
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
  background: #05070f;
  border-top: 1px solid rgba(241,244,238,0.1);
  padding: 28px clamp(20px, 5vw, 48px);
}
.site-footer-inner {
  max-width: 1100px; margin: 0 auto;
  display: flex; align-items: center; justify-content: space-between;
  gap: 16px; flex-wrap: wrap;
}
.site-footer-brand {
  font-family: var(--font-sans-stack); font-weight: 600; font-size: 14px;
  color: rgba(241,244,238,0.72); letter-spacing: -0.01em;
}
.site-footer-links { display: flex; align-items: center; gap: 22px; flex-wrap: wrap; }
.site-footer-link {
  font-size: 14px; color: rgba(241,244,238,0.66); text-decoration: none;
  transition: color 0.15s ease;
}
.site-footer-link:hover { color: rgba(244,246,248,1); }
`;
