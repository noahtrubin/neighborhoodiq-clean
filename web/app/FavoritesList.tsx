"use client";

import { useEffect, useState } from "react";
import { useAuth } from "./lib/AuthProvider";
import Icon from "./components/Icon";
import type { ZipData } from "./lib/types";

export default function FavoritesList({ onSelect }: { onSelect: (z: string) => void }) {
  const { user, favorites } = useAuth();
  const [data, setData] = useState<ZipData[]>([]);

  // Resolve the favorited ZIPs (arbitrary, not necessarily in the top list)
  // through the predict endpoint.
  useEffect(() => {
    const zips = [...favorites];
    if (zips.length === 0) { setData([]); return; }
    let cancelled = false;
    fetch(`/api/predict?zips=${zips.join(",")}`)
      .then((r) => r.json())
      .then((j) => { if (!cancelled) setData(j.results ?? []); })
      .catch(() => { if (!cancelled) setData([]); });
    return () => { cancelled = true; };
  }, [favorites]);

  if (!user || data.length === 0) return null;

  return (
    <div>
      <div className="niq-city-label" style={{ marginTop: 0 }}>
        <Icon name="star-filled" size={13} style={{ color: "var(--accent-ink)" }} />
        Your favorites
      </div>
      <div className="niq-dir-grid">
        {data.map((d) => (
          <div key={d.zip} className="niq-zip-card" onClick={() => onSelect(d.zip)}>
            <div className="niq-zip-top">
              <span className="niq-zip-code">{d.zip}</span>
              <span className="niq-zip-score" title="U.S. percentile rank">{d.rank != null ? `${d.rank}%` : d.score}</span>
            </div>
            <div className="niq-zip-name">{d.city}, {d.state}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
