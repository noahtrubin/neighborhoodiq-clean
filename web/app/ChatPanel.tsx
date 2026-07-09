"use client";

import { useEffect, useState } from "react";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import type { ZipData } from "./lib/types";
import { useAuth } from "./lib/AuthProvider";
import { db } from "./lib/firebase-client";
import Icon from "./components/Icon";

type Msg = { role: "user" | "assistant"; content: string };

export default function ChatPanel({
  zip,
  name,
  city,
  data,
}: {
  zip: string;
  name: string;
  city: string;
  data: ZipData;
}) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Start a fresh conversation whenever the selected ZIP changes.
  useEffect(() => {
    setMessages([]);
    setError(null);
    setSaved(false);
  }, [zip]);

  const send = async () => {
    const q = input.trim();
    if (!q || loading) return;
    setError(null);
    setSaved(false);
    const next: Msg[] = [...messages, { role: "user", content: q }];
    setMessages(next);
    setInput("");
    setLoading(true);
    try {
      const resp = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ zip, context: data, messages: next }),
      });
      if (!resp.ok) {
        const b = await resp.json().catch(() => ({}));
        throw new Error(b.error || `Request failed (${resp.status})`);
      }
      const { reply } = await resp.json();
      setMessages([...next, { role: "assistant", content: reply }]);
    } catch {
      setError("Couldn't reach the AI. Try again.");
    }
    setLoading(false);
  };

  const saveChat = async () => {
    if (!user || messages.length === 0) return;
    try {
      await addDoc(collection(db, "users", user.uid, "chats"), {
        zip,
        name,
        city,
        messages,
        savedAt: serverTimestamp(),
      });
      setSaved(true);
    } catch {
      setError("Couldn't save the chat.");
    }
  };

  return (
    <div className="niq-card" style={{ marginTop: 18, padding: 20 }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 10,
          marginBottom: 4,
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 700 }}>Ask AI about {name}</div>
        {user && messages.length > 0 && (
          <button className="niq-tab" data-active={saved} onClick={saveChat}>
            <Icon name={saved ? "check" : "star"} size={14} />
            {saved ? "Saved" : "Save chat"}
          </button>
        )}
      </div>
      <div style={{ fontSize: 12.5, color: "var(--ink-muted)", marginBottom: 14 }}>
        Answers are grounded in the data we have for {zip} ({city}); it will say
        when it doesn&apos;t have something rather than guess.
      </div>

      {messages.length > 0 && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 10,
            marginBottom: 14,
          }}
        >
          {messages.map((m, i) => (
            <div
              key={i}
              className={`niq-bubble ${m.role === "user" ? "niq-bubble--user" : "niq-bubble--ai"}`}
            >
              {m.content}
            </div>
          ))}
        </div>
      )}

      {loading && (
        <div style={{ fontSize: 13, color: "var(--ink-muted)", marginBottom: 10 }}>
          Thinking…
        </div>
      )}
      {error && (
        <div className="niq-alert" style={{ marginBottom: 10 }}>
          {error}
        </div>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <input
          className="niq-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder={'e.g. "What does the momentum score mean?"'}
        />
        <button className="niq-btn" onClick={send} disabled={loading} aria-label="Send message">
          Ask
          <Icon name="send" size={16} />
        </button>
      </div>
    </div>
  );
}
