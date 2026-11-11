import { useState } from "react";
import { X } from "lucide-react";
import { supabase } from "./lib/supabase";
import { reportCriticalError } from "./lib/errorReporting";
import { supabaseErrorMessage } from "./lib/errorMessages";

export default function AppointmentRescheduleDialog({ appointment, onClose, onSaved }) {
  const [date, setDate] = useState(appointment.appointment_date);
  const [time, setTime] = useState(appointment.start_time?.slice(0, 5) || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event) => {
    event.preventDefault();
    if (saving || !supabase) return;
    if (date === appointment.appointment_date && time === appointment.start_time?.slice(0, 5)) {
      setError("Επιλέξτε διαφορετική ημερομηνία ή ώρα.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const { error: requestError } = await supabase.rpc("reschedule_appointment", {
        p_appointment: appointment.id,
        p_date: date,
        p_start_time: `${time}:00`,
      });
      if (requestError) throw requestError;
      await onSaved?.();
      onClose();
    } catch (requestError) {
      reportCriticalError(requestError, { feature: "appointments", operation: "reschedule" });
      setError(supabaseErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop open">
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="reschedule-title">
        <div className="modal-header">
          <div>
            <span className="eyebrow">ΑΛΛΑΓΗ ΡΑΝΤΕΒΟΥ</span>
            <h2 id="reschedule-title">{appointment.customer_name || appointment.business?.name}</h2>
          </div>
          <button type="button" className="icon-button" aria-label="Κλείσιμο" onClick={onClose} disabled={saving}>
            <X size={18} />
          </button>
        </div>
        <form onSubmit={submit}>
          {error && <div className="notice" role="alert">{error}</div>}
          <label>
            Ημερομηνία
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} required disabled={saving} />
          </label>
          <label>
            Ώρα έναρξης
            <input type="time" value={time} onChange={(event) => setTime(event.target.value)} required disabled={saving} />
          </label>
          <p className="reschedule-policy-note">Η νέα ώρα ελέγχεται από τη βάση ως προς το ωράριο και τις υπάρχουσες κρατήσεις.</p>
          <div className="modal-footer">
            <button type="button" className="outline-button" onClick={onClose} disabled={saving}>Άκυρο</button>
            <button type="submit" className="primary-button" disabled={saving || !date || !time}>
              {saving ? "Έλεγχος και αποθήκευση..." : "Αποθήκευση νέας ώρας"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}