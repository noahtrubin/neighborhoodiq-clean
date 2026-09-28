"use client";

import { useEffect, useRef, useState } from "react";

// Plain-language model explainer, surfaced as a visible popover so the trust +
// coverage story isn't buried in fine print. Lives in the header, so the
// popover opens leftward from the top-right corner (`align="right"`).
//
// Outside-click closes it via a document listener rather than a fixed
// backdrop: the sticky header's backdrop-filter would trap a fixed element
// inside the header's box, so a backdrop couldn't cover the page from there.
export default function ModelInfo({ align = "center" }: { align?: "center" | "right" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className={`niq-modelinfo${align === "right" ? " niq-modelinfo--right" : ""}`}>
      <button className="niq-info-btn" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        How the score works
      </button>
      {open && (
        <div className="niq-info-pop" role="dialog" aria-label="How the score works">
          <h4>How the score works</h4>
          <div className="niq-info-row"><span className="niq-info-dot" /><div><b>What it is.</b> The <b>calibrated chance</b> this ZIP&apos;s home value is higher in 2 years than today. When we say 80%, about 80% of such ZIPs actually rose in backtest.</div></div>
          <div className="niq-info-row"><span className="niq-info-dot" /><div><b>The data.</b> 20+ years of real Zillow ZIP-level home values: price momentum (how fast it&apos;s rising) and affordability versus the local metro. Nothing else.</div></div>
          <div className="niq-info-row"><span className="niq-info-dot" /><div><b>Read it right.</b> Most neighborhoods rise, so most read high — the signal is the number and the <b>Elevated&nbsp;risk</b> flag on the ~10–15% likelier to stall or fall.</div></div>
          <div className="niq-info-row"><span className="niq-info-dot" /><div><b>How good is it?</b> Out-of-time backtest AUC ≈ 0.66 (≈0.72 recent). It reads today&apos;s conditions — it can&apos;t foresee a rate shock or crash. A guide, not a guarantee.</div></div>
        </div>
      )}
    </div>
  );
}
