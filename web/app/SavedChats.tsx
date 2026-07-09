"use client";

import { useEffect, useState } from "react";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { useAuth } from "./lib/AuthProvider";
import { db } from "./lib/firebase-client";

type SavedChat = {
  id: string;
  zip: string;
  name: string;
  city: string;
  messages: { role: string; content: string }[];
};

export default function SavedChats() {
  const { user } = useAuth();
  const [chats, setChats] = useState<SavedChat[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    if (!user) {
      setChats([]);
      return;
    }
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

  if (!user || chats.length === 0) return null;

  return (
    <div className="niq-section">
      <div className="niq-section-title">Your saved chats</div>
      <div className="niq-section-sub">
        Conversations you saved, newest first. Click one to read it.
      </div>
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
    </div>
  );
}
