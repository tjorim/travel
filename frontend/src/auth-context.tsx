import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";

import { beginSignIn, readSession, shouldRestoreSession, type TrackerSession } from "./auth";

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

  return <AuthContext.Provider value={{ session, setSession }}>{children}</AuthContext.Provider>;
}
