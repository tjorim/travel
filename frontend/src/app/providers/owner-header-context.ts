import { createContext } from "react";

export const OwnerHeaderContext = createContext<{
  action: (() => void) | null;
  setAction: (action: (() => void) | null) => void;
}>({ action: null, setAction: () => undefined });
