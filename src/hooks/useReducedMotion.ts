import { useEffect, useState } from "react";
import {
  resolveReducedMotion,
  usePreferences,
} from "../interaction/preferences";
export function useSystemReducedMotion() {
  const [reduced, setReduced] = useState(
    () => matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)"),
      update = () => setReduced(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return reduced;
}
export function useReducedMotion() {
  const systemReduced = useSystemReducedMotion();
  const { motion } = usePreferences();
  return resolveReducedMotion(motion, systemReduced);
}
