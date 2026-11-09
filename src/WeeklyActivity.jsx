import { useEffect, useRef } from "react";
import { useMotion } from "./AmbientExperience";

export function AnimatedNumber({ value }) {
  const element = useRef(null);
  const motion = useMotion();
  useEffect(() => {
    const node = element.current;
    if (!node) return undefined;
    if (motion?.reduced || document.hidden || !value) {
      node.textContent = String(value);
      return undefined;
    }
    let frame;
    let start;
    const animate = (time) => {
      start ??= time;
      const progress = Math.min((time - start) / 650, 1);
      node.textContent = String(Math.round(value * (1 - (1 - progress) ** 3)));
      if (progress < 1 && !document.hidden) frame = requestAnimationFrame(animate);
      else node.textContent = String(value);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [value, motion?.reduced]);
  return <strong aria-label={String(value)}><span aria-hidden="true" ref={element}>{value}</span></strong>;
}

export default function WeeklyActivity({ appointments, weekStart, loading }) {
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(weekStart);
    date.setDate(date.getDate() + index);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    return {
      key,
      label: date.toLocaleDateString("el-GR", { weekday: "short" }),
      count: appointments.filter((appointment) => appointment.appointment_date === key).length,
    };
  });
  const maximum = Math.max(1, ...days.map((day) => day.count));

  return (
    <section className="weekly-activity" aria-labelledby="weekly-activity-title">
      <div className="weekly-activity-header">
        <div><h2 id="weekly-activity-title">Ραντεβού εβδομάδας</h2><p>Κατανομή ανά ημέρα</p></div>
        <span>{loading ? "Φόρτωση..." : `${appointments.length} συνολικά`}</span>
      </div>
      {loading ? <div className="weekly-activity-loading" role="status">Φόρτωση...</div> : (
        <div className="weekly-activity-chart">
          {days.map((day) => (
            <div className="weekly-activity-day" key={day.key} role="img" aria-label={`${day.label}: ${day.count} ραντεβού`}>
              <span className="weekly-activity-count">{day.count}</span>
              <div className="weekly-activity-track"><div className="weekly-activity-bar" style={{ height: `${day.count / maximum * 100}%` }} /></div>
              <span>{day.label}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}