import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";

import {
  beginSignIn,
  renewSession,
  readSession,
  shouldRestoreSession,
  type TrackerSession,
} from "./auth";

type AuthContextValue = {
  session: TrackerSession | null;
  setSession: (session: TrackerSession | null) => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("Travel tracker authentication context is missing.");
  return context;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<TrackerSession | null>(() => readSession());
  const restoring = useRef(false);

  useEffect(() => {
    if (
      session ||
      restoring.current ||
      !shouldRestoreSession() ||
      window.location.pathname.endsWith("/auth/callback")
    )
      return;
    restoring.current = true;
    const returnPath = window.location.pathname.replace(/^\/admin(?=\/|$)/, "") || "/";
    void beginSignIn(returnPath, { silent: true });
  }, [session]);

  useEffect(() => {
    const updated = () => setSession(readSession());
    window.addEventListener("travel-session-renewed", updated);
    return () => window.removeEventListener("travel-session-renewed", updated);
  }, []);

  useEffect(() => {
    if (!session) return;
    const renew = () => {
      void renewSession().catch(() => {});
    };
    const focus = () => {
      if (session.expiresAt <= Date.now() + 30_000) renew();
    };
    const timer = window.setTimeout(renew, Math.max(1000, session.expiresAt - Date.now() - 30_000));
    window.addEventListener("focus", focus);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", focus);
    };
  }, [session]);

  return <AuthContext.Provider value={{ session, setSession }}>{children}</AuthContext.Provider>;
}
