import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { beginSignIn, completeSignIn } from "../auth";
import { useAuth } from "../auth-context";

export function Callback() {
  const { setSession } = useAuth();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const [message, setMessage] = useState("Aanmelden wordt afgerond…");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    void completeSignIn(search.toString())
      .then(({ returnPath, session }) => {
        setSession(session);
        navigate(returnPath, { replace: true });
      })
      .catch((error: unknown) => {
        setFailed(true);
        setMessage(error instanceof Error ? error.message : "Aanmelden is mislukt.");
      });
  }, [navigate, search, setSession]);

  return (
    <main className="shell">
      <section className="card">
        <h1>Aanmelden</h1>
        <p>{message}</p>
        {failed && <button type="button" onClick={() => void beginSignIn("/")}>Opnieuw aanmelden</button>}
      </section>
    </main>
  );
}
