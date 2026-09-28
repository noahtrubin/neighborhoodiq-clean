"use client";

import { useEffect, useState } from "react";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { db } from "./lib/firebase-client";

export type SavedChat = {
  id: string;
  zip: string;
  name: string;
  city: string;
  messages: { role: string; content: string }[];
};

// Live-syncs this user's saved chats from Firestore, newest first. Lifted out
// of the list so the Saved section can show a count before it's expanded.
export function useSavedChats(user: { uid: string } | null): SavedChat[] {
  const [chats, setChats] = useState<SavedChat[]>([]);

  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, "users", user.uid, "chats"),
      orderBy("savedAt", "desc"),
    );
    return onSnapshot(q, (snap) => {
      setChats(
        snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<SavedChat, "id">),
        })),
      );
    });
  }, [user]);

  // Signed out: nothing to show, whatever the last subscription left behind.
  return user ? chats : [];
}

export default function SavedChatsList({ chats }: { chats: SavedChat[] }) {
  const [openId, setOpenId] = useState<string | null>(null);

  if (chats.length === 0) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {chats.map((c) => (
        <div key={c.id} className="niq-card" style={{ padding: 14 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              cursor: "pointer",
            }}
            onClick={() => setOpenId(openId === c.id ? null : c.id)}
          >
            <span style={{ fontWeight: 600, fontSize: 13.5 }}>
              {c.name} · {c.zip}
            </span>
            <span style={{ color: "var(--ink-muted)", fontSize: 12.5 }}>
              {c.messages.length} messages · {openId === c.id ? "hide" : "view"}
            </span>
          </div>
          {openId === c.id && (
            <div
              style={{
                marginTop: 10,
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              {c.messages.map((m, i) => (
                <div key={i} style={{ fontSize: 13, lineHeight: 1.5 }}>
                  <b>{m.role === "user" ? "You" : "AI"}:</b> {m.content}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
