import { useEffect, useState } from "react";

export type PointerType = "touch" | "mouse";

function detect(): PointerType {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return "mouse";
  }
  return window.matchMedia("(hover: hover)").matches ? "mouse" : "touch";
}

export function usePointerType(): PointerType {
  const [type, setType] = useState<PointerType>("mouse");
  useEffect(() => {
    setType(detect());
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const mq = window.matchMedia("(hover: hover)");
    const handler = () => setType(mq.matches ? "mouse" : "touch");
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return type;
}
