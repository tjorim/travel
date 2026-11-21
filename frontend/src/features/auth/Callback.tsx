import { useFeedback, textNotice, errorNotice } from "@/lib/api/feedback";
import { useLocale } from "@/i18n/locale";
import { VisitorTopBar } from "@/components/VisitorTopBar";
import { m } from "@/paraglide/messages.js";
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";

import { beginSignIn, completeSignIn } from "@/lib/auth";
import { useAuth } from "@/app/providers/auth-context";

export function Callback() {
  useLocale();
  const { setSession } = useAuth();
  const navigate = useNavigate();
  const [message, setMessage] = useFeedback<string>(textNotice(m.session_completing_sign_in));
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    void completeSignIn(window.location.search)
      .then(({ returnPath, session }) => {
        setSession(session);
        void navigate({ to: returnPath, replace: true });
      })
      .catch((error: unknown) => {
        setFailed(true);
        setMessage(errorNotice(error, m.session_sign_in_failed));
      });
  }, [navigate, setSession]);

  return (
    <main className="travel-shell pt-6!">
      <VisitorTopBar />
      <section className="travel-card">
        <h1>{m.sign_in()}</h1>
        <p>{message}</p>
        {failed && (
          <Button type="button" onClick={() => void beginSignIn("/")}>
            {m.session_sign_in_again()}
          </Button>
        )}
      </section>
    </main>
  );
}
