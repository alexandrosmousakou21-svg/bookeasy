import { createContext, useContext, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import "./ambient.css";

const MotionContext = createContext(null);

export function useMotion() {
  return useContext(MotionContext);
}

function AmbientScene({ reduced, scene }) {
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

  return <div className={`ambient-layer${reduced ? " is-reduced" : ""}`} data-scene={scene} aria-hidden="true"><canvas id="bookeasy-ambient-canvas" /></div>;
}

export default function AmbientExperience({ children }) {
  const { pathname } = useLocation();
  const scene = pathname === "/" ? "home" : pathname.startsWith("/dashboard") ? "workspace" : /^\/(book|b)\//.test(pathname) ? "booking" : pathname.startsWith("/customer") || pathname === "/my-appointments" ? "customer" : "auth";
  const [systemReduced, setSystemReduced] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const reduced = systemReduced;

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setSystemReduced(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (reduced || !window.matchMedia("(hover: hover) and (pointer: fine)").matches) return undefined;
    let frame = 0;
    let target;
    let pointerX = 0;
    let pointerY = 0;
    const updateReflection = () => {
      frame = 0;
      if (!target || !target.isConnected) return;
      const bounds = target.getBoundingClientRect();
      target.style.setProperty("--reflection-x", `${pointerX - bounds.left}px`);
      target.style.setProperty("--reflection-y", `${pointerY - bounds.top}px`);
    };
    const move = (event) => {
      target = event.target.closest(".business-card, .service-card, .staff-card");
      if (!target) return;
      pointerX = event.clientX;
      pointerY = event.clientY;
      if (!frame) frame = requestAnimationFrame(updateReflection);
    };
    document.addEventListener("pointermove", move, { passive: true });
    return () => {
      document.removeEventListener("pointermove", move);
      cancelAnimationFrame(frame);
    };
  }, [reduced]);

  return (
    <MotionContext.Provider value={{ reduced }}>
      <AmbientScene reduced={reduced} scene={scene} />
      <div className="experience-content" data-reduced-motion={reduced} data-scene={scene}>{children}</div>
    </MotionContext.Provider>
  );
}