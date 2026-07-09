"use client";

// Auth + favorites context. Wraps the app (see layout.tsx). Components call
// useAuth() to get the signed-in user, their favorited ZIPs, and actions.
//
// - Auth: Firebase Google sign-in (client SDK).
// - Favorites: stored at users/{uid}/favorites/{zip} in Firestore, live-synced.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  type User,
} from "firebase/auth";
import { collection, deleteDoc, doc, onSnapshot, setDoc } from "firebase/firestore";
import { auth, db } from "./firebase-client";

type AuthCtx = {
  user: User | null;
  loading: boolean;
  favorites: Set<string>;
  signIn: () => Promise<void>;
  logout: () => Promise<void>;
  toggleFavorite: (zip: string) => Promise<void>;
};

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());

  // Track sign-in state.
  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
  }, []);

  // Live-sync this user's favorites from Firestore.
  useEffect(() => {
    if (!user) {
      setFavorites(new Set());
      return;
    }
    const col = collection(db, "users", user.uid, "favorites");
    return onSnapshot(col, (snap) => {
      setFavorites(new Set(snap.docs.map((d) => d.id)));
    });
  }, [user]);

  const signIn = useCallback(async () => {
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (e) {
      // These are normal user actions (popup closed, or a second popup opened
      // before the first resolved), not real errors — ignore them quietly.
      const code = (e as { code?: string })?.code ?? "";
      if (
        code === "auth/cancelled-popup-request" ||
        code === "auth/popup-closed-by-user" ||
        code === "auth/user-cancelled"
      ) {
        return;
      }
      console.error("sign-in failed", e);
    }
  }, []);

  const logout = useCallback(async () => {
    await signOut(auth);
  }, []);

  const toggleFavorite = useCallback(
    async (zip: string) => {
      if (!user) {
        await signIn();
        return;
      }
      const ref = doc(db, "users", user.uid, "favorites", zip);
      if (favorites.has(zip)) await deleteDoc(ref);
      else await setDoc(ref, { zip, addedAt: Date.now() });
    },
    [user, favorites, signIn],
  );

  return (
    <Ctx.Provider value={{ user, loading, favorites, signIn, logout, toggleFavorite }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth(): AuthCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth must be used within AuthProvider");
  return c;
}
