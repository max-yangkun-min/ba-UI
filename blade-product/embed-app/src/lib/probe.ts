import { useEffect, useState } from "react";

export type ProbeState = "checking" | "up" | "down";

export function useServiceProbe(url: string): ProbeState {
  const [state, setState] = useState<ProbeState>("checking");

  useEffect(() => {
    if (!url) {
      setState("down");
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 2500);
    fetch(url, { mode: "no-cors", signal: controller.signal })
      .then(() => setState("up"))
      .catch(() => setState("down"))
      .finally(() => window.clearTimeout(timer));
    return () => controller.abort();
  }, [url]);

  return state;
}
