import { createContext, useContext, useEffect, useState } from "react";
import { Activity, Pause } from "lucide-react";
import "./ambient.css";

const MotionContext = createContext(null);
const motionKey = "bookeasy-reduce-motion";

export function useMotion() {
  return useContext(MotionContext);
}

function savedPreference() {
  try {
    return localStorage.getItem(motionKey) === "true";
  } catch {
    return false;
  }
}

export function MotionControl() {
  const motion = useContext(MotionContext);
  if (!motion) return null;
  return (
    <button
      type="button"
      className="motion-control"
      aria-label="Μείωση κίνησης"
      aria-pressed={motion.reduced}
      title={motion.systemReduced ? "Η μειωμένη κίνηση είναι ενεργή στη συσκευή" : motion.reduced ? "Ενεργοποίηση κίνησης" : "Μείωση κίνησης"}
      disabled={motion.systemReduced}
      onClick={() => motion.setPreference(!motion.preference)}
    >
      {motion.reduced ? <Pause size={17} /> : <Activity size={17} />}
    </button>
  );
}

function AmbientScene({ reduced }) {
  useEffect(() => {
    if (reduced) return undefined;
    let disposed = false;
    let cleanup = () => {};

    import("./ambientScene").then(({ startAmbientScene }) => {
      if (disposed) return;
      const canvas = document.getElementById("bookeasy-ambient-canvas");
      if (canvas) cleanup = startAmbientScene(canvas);
    }).catch(() => {});

    return () => {
      disposed = true;
      cleanup();
    };
  }, [reduced]);

  return <div className={`ambient-layer${reduced ? " is-reduced" : ""}`} aria-hidden="true"><canvas id="bookeasy-ambient-canvas" /></div>;
}

export default function AmbientExperience({ children }) {
  const [preference, setPreference] = useState(savedPreference);
  const [systemReduced, setSystemReduced] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const reduced = preference || systemReduced;

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setSystemReduced(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(motionKey, String(preference));
    } catch {
      return;
    }
  }, [preference]);

  return (
    <MotionContext.Provider value={{ preference, setPreference, systemReduced, reduced }}>
      <AmbientScene reduced={reduced} />
      <div className="experience-content" data-reduced-motion={reduced}>{children}</div>
    </MotionContext.Provider>
  );
}