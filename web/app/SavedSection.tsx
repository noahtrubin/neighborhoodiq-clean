"use client";

import { useEffect, useState } from "react";
import { useAuth } from "./lib/AuthProvider";
import FavoritesList from "./FavoritesList";
import SavedChatsList, { useSavedChats } from "./SavedChats";

// One compact "Saved" row at the foot of the dashboard: favorites and saved
// chats behind tabs, collapsed by default so they don't compete with results.
type Tab = "favorites" | "chats";

export default function SavedSection({ onSelect }: { onSelect: (zip: string) => void }) {
  const { user, favorites } = useAuth();
  const chats = useSavedChats(user);
  const nFav = favorites.size;
  const nChats = chats.length;
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab | null>(null);

  // The user-menu link (/dashboard#saved) should land here expanded, whether
  // it navigates to the page or just changes the hash on it.
  useEffect(() => {
    const sync = () => {
      if (window.location.hash === "#saved") setOpen(true);
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  if (!user || (nFav === 0 && nChats === 0)) return null;
  const active: Tab = tab ?? (nFav > 0 ? "favorites" : "chats");
  const pick = (t: Tab) => {
    setTab(t);
    setOpen(true);
  };

  return (
    <section id="saved" className="niq-section niq-saved">
      <div className="niq-saved-head">
        <div className="niq-section-title">Saved</div>
        <div className="niq-tabs">
          <button className="niq-tab" data-active={active === "favorites"} onClick={() => pick("favorites")}>
            Favorites · {nFav}
          </button>
          <button className="niq-tab" data-active={active === "chats"} onClick={() => pick("chats")}>
            Chats · {nChats}
          </button>
        </div>
        <button className="niq-tab niq-saved-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? "Hide" : "Show"}
        </button>
      </div>
      {open && (active === "favorites" ? <FavoritesList onSelect={onSelect} /> : <SavedChatsList chats={chats} />)}
    </section>
  );
}
