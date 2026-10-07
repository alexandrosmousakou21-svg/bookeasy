import { useState } from "react";
import { Link } from "react-router-dom";
import { Menu, X } from "lucide-react";

const ITEMS = [
  ["Αρχική", "/"],
  ["Πώς λειτουργεί", "/#how"],
  ["Για επαγγελματίες", "/#professionals"],
  ["Για πελάτες", "/#customers"],
  ["Τιμές", "/#pricing"],
  ["FAQ", "/#faq"],
  ["Εγκατάσταση App", "/install"],
];

export default function MarketingNav() {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <header className="mk-nav">
      <Link className="brand" to="/" onClick={close}>
        <span className="brand-mark">B</span>
        <span>
          book<span>easy</span>
        </span>
      </Link>
      <nav className={open ? "open" : ""} aria-label="Κύρια πλοήγηση">
        {ITEMS.map(([label, href]) => (
          <a key={label} href={href} onClick={close}>
            {label}
          </a>
        ))}
        <Link to="/login" onClick={close}>Σύνδεση</Link>
        <Link to="/register" onClick={close}>Εγγραφή</Link>
      </nav>
      <Link className="primary-button compact mk-nav-cta" to="/install">
        Κατέβασε το App
      </Link>
      <button
        className="icon-button mk-burger"
        aria-label="Μενού"
        onClick={() => setOpen(!open)}
      >
        {open ? <X size={22} /> : <Menu size={22} />}
      </button>
    </header>
  );
}
