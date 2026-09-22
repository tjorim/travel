import { createContext, useContext, useState, type ReactNode } from "react";

import { readSession, type TrackerSession } from "./auth";

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
  return <AuthContext.Provider value={{ session, setSession }}>{children}</AuthContext.Provider>;
}
