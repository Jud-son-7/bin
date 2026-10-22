// Firebase web config comes from app/.env (copy .env.example to .env and fill it in).
// Find the values in: Firebase Console > Project settings > Your apps > Web app > Config.
// This config is NOT secret, but never put Admin SDK keys in the app.
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const env = import.meta.env;

const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
};

// Without these three the app falls back to demo data.
export const configured = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId);
export const db = configured ? getFirestore(initializeApp(firebaseConfig)) : null;
