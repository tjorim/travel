import { Button } from "@base-ui/react/button";
import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";

import { beginSignIn, completeSignIn } from "../auth";
import { useAuth } from "../auth-context";

export function Callback() {
  const { setSession } = useAuth();
  const navigate = useNavigate();
  const [message, setMessage] = useState("Aanmelden wordt afgerond…");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    void completeSignIn(window.location.search)
      .then(({ returnPath, session }) => {
        setSession(session);
        void navigate({ to: returnPath, replace: true });
      })
      .catch((error: unknown) => {
        setFailed(true);
        setMessage(error instanceof Error ? error.message : "Aanmelden is mislukt.");
      });
  }, [navigate, setSession]);

  return (
    <main className="travel-shell">
      <section className="travel-card">
        <h1>Aanmelden</h1>
        <p>{message}</p>
        {failed && (
          <Button type="button" onClick={() => void beginSignIn("/")}>
            Opnieuw aanmelden
          </Button>
        )}
      </section>
    </main>
  );
}
