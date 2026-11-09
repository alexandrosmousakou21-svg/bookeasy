import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";

const ToastContext = createContext(null);
const ConfirmContext = createContext(null);

export function useToast() {
  return useContext(ToastContext) || (() => {});
}

export function useConfirm() {
  return useContext(ConfirmContext) || (async () => window.confirm("Είστε σίγουροι;"));
}

const toastIcons = { success: CheckCircle2, error: AlertTriangle, info: Info };

function ToastRegion({ toasts, dismiss }) {
  return (
    <div className="toast-region" role="region" aria-label="Ειδοποιήσεις">
      {toasts.map((item) => {
        const Icon = toastIcons[item.tone] || Info;
        return (
          <div key={item.id} className={`toast toast-${item.tone}`} role={item.tone === "error" ? "alert" : "status"}>
            <Icon size={18} aria-hidden="true" />
            <span>{item.message}</span>
            <button type="button" className="toast-close" aria-label="Κλείσιμο ειδοποίησης" onClick={() => dismiss(item.id)}>
              <X size={15} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

function ConfirmDialog({ request, onResult }) {
  const cancelRef = useRef(null);
  const dialogRef = useRef(null);

  useEffect(() => {
    const previous = document.activeElement;
    cancelRef.current?.focus();
    const onKey = (event) => {
      if (event.key === "Escape") onResult(false);
      if (event.key !== "Tab") return;
      const focusable = dialogRef.current?.querySelectorAll("button:not(:disabled)");
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, [onResult]);

  return (
    <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onResult(false)}>
      <div ref={dialogRef} className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-message">
        <div className={`dialog-icon ${request.tone === "danger" ? "is-danger" : ""}`}>
          <AlertTriangle size={20} aria-hidden="true" />
        </div>
        <h2 id="confirm-title">{request.title}</h2>
        <p id="confirm-message">{request.message}</p>
        <div className="dialog-actions">
          <button ref={cancelRef} type="button" className="outline-button" onClick={() => onResult(false)}>
            {request.cancelLabel || "Άκυρο"}
          </button>
          <button type="button" className={request.tone === "danger" ? "primary-button danger-action" : "primary-button"} onClick={() => onResult(true)}>
            {request.confirmLabel || "Επιβεβαίωση"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function UiProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const [request, setRequest] = useState(null);
  const resolver = useRef(null);
  const counter = useRef(0);

  const dismiss = useCallback((id) => setToasts((current) => current.filter((item) => item.id !== id)), []);
  const toast = useCallback((message, tone = "info") => {
    counter.current += 1;
    const id = counter.current;
    setToasts((current) => [...current.slice(-3), { id, message, tone }]);
    window.setTimeout(() => dismiss(id), tone === "error" ? 8000 : 5000);
  }, [dismiss]);

  const confirm = useCallback((options) => new Promise((resolve) => {
    resolver.current?.(false);
    resolver.current = resolve;
    setRequest(options);
  }), []);
  const settle = useCallback((result) => {
    resolver.current?.(result);
    resolver.current = null;
    setRequest(null);
  }, []);

  const toastApi = useMemo(() => toast, [toast]);
  return (
    <ToastContext.Provider value={toastApi}>
      <ConfirmContext.Provider value={confirm}>
        {children}
        <ToastRegion toasts={toasts} dismiss={dismiss} />
        {request && <ConfirmDialog request={request} onResult={settle} />}
      </ConfirmContext.Provider>
    </ToastContext.Provider>
  );
}

export function Skeleton({ lines = 3, className = "" }) {
  return (
    <div className={`skeleton-block ${className}`} role="status" aria-label="Φόρτωση">
      {Array.from({ length: lines }, (_, index) => (
        <span className="skeleton-line" key={index} style={{ width: `${100 - (index % 3) * 18}%` }} />
      ))}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, children }) {
  return (
    <div className="empty-state-rich">
      {Icon && <span className="empty-state-icon"><Icon size={22} aria-hidden="true" /></span>}
      <strong>{title}</strong>
      {children && <p>{children}</p>}
    </div>
  );
}

export function StatusDot({ tone = "ok", label }) {
  return (
    <span className={`status-dot status-dot-${tone}`} role="img" aria-label={label}>
      <i />
    </span>
  );
}
