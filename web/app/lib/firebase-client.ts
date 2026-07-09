"use client";

// Firebase WEB (client) config. These values are PUBLIC by design — they ship to
// the browser. Security is enforced by Firestore security rules, not by secrecy.
import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  "projectId": "neighborhoodiq-cb9eb",
  "appId": "1:632602896555:web:fd3b39ed1ef90d54892fee",
  "storageBucket": "neighborhoodiq-cb9eb.firebasestorage.app",
  "apiKey": "AIzaSyCCpamLCneROKgWLinpB9sFdqVyyL4AwKo",
  "authDomain": "neighborhoodiq-cb9eb.firebaseapp.com",
  "messagingSenderId": "632602896555",
  "projectNumber": "632602896555",
  "version": "2"
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
