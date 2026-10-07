import { useEffect } from "react";
import { Link } from "react-router-dom";
import MarketingNav from "./MarketingNav";
import InstallAppSection from "./InstallAppSection";

const TITLE = "BookEasy — Online κρατήσεις για επαγγελματίες";
const DESC =
  "Το BookEasy οργανώνει κρατήσεις, πελάτες, υπηρεσίες και ραντεβού σε μία εφαρμογή.";

export function usePageMeta(title, description) {
  useEffect(() => {
    const prevTitle = document.title;
    document.title = title;
    let meta = document.querySelector('meta[name="description"]');
    const created = !meta;
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "description";
      document.head.appendChild(meta);
    }
    const prevDesc = meta.content;
    meta.content = description;
    return () => {
      document.title = prevTitle;
      if (created) meta.remove();
      else meta.content = prevDesc;
    };
  }, [title, description]);
}

const PRO = [
  ["Online κρατήσεις", "Δική σου σελίδα κρατήσεων, διαθέσιμη 24/7."],
  ["Ραντεβού", "Ημερολόγιο και λίστα ραντεβού σε ένα σημείο."],
  ["Πελάτες", "Αρχείο πελατών και ιστορικό επισκέψεων."],
  ["Προσωπικό", "Διαχείριση υπαλλήλων και υπηρεσιών."],
  ["Ωράριο εργασίας", "Ορίζεις διαθεσιμότητα ανά ημέρα και μέλος."],
  ["Ειδοποιήσεις", "Ενημερώσεις για νέα ραντεβού και αλλαγές."],
  ["AI εξυπηρέτηση πελατών", "Βοηθός AI για τις καθημερινές ερωτήσεις."],
  ["Πλάνα συνδρομής", "Επίλεξε το πλάνο που ταιριάζει στην επιχείρησή σου."],
];
const CUSTOMERS = [
  ["Ανακάλυψε επιχειρήσεις", "Βρες επαγγελματίες και δες τις υπηρεσίες τους."],
  ["Κλείσε ραντεβού", "Διάλεξε υπηρεσία και διαθέσιμη ώρα σε λίγα βήματα."],
  ["Διαχειρίσου τα ραντεβού σου", "Δες και οργάνωσε τα ραντεβού σου."],
  ["Λάβε ειδοποιήσεις", "Μείνε ενημερωμένος για επιβεβαιώσεις και αλλαγές."],
  ["Επικοινώνησε", "Επικοινώνησε εύκολα με την επιχείρηση."],
];
const PLANS = [
  ["Basic", "Για να ξεκινήσεις με online κρατήσεις και διαχείριση ραντεβού."],
  ["Plus", "Για επιχειρήσεις που θέλουν περισσότερες δυνατότητες."],
];
const FAQ = [
  ["Τι είναι το BookEasy;", "Μια εφαρμογή που οργανώνει κρατήσεις, πελάτες, υπηρεσίες και ραντεβού."],
  ["Χρειάζεται να κατεβάσω την εφαρμογή για να κλείσω ραντεβού;", "Όχι. Μπορείς να κλείσεις ραντεβού από τη σελίδα της επιχείρησης χωρίς εγκατάσταση."],
  ["Μπορώ να χρησιμοποιήσω το BookEasy από το web;", "Ναι, ο λογαριασμός επαγγελματία παραμένει προσβάσιμος και από το web. Η πλήρης εμπειρία είναι διαθέσιμη στην εφαρμογή."],
  ["Πού θα βρω την εφαρμογή;", "Στο App Store και στο Google Play. Αν δεν έχει δημοσιευτεί ακόμη, θα δεις την ένδειξη «Σύντομα»."],
  ["Πώς επιλέγω πλάνο;", "Μετά την εγγραφή, από τη σελίδα Πλάνου του λογαριασμού σου."],
];

function Cards({ items }) {
  return (
    <div className="mk-grid">
      {items.map(([t, d]) => (
        <div className="panel mk-card" key={t}>
          <strong>{t}</strong>
          <p>{d}</p>
        </div>
      ))}
    </div>
  );
}

export default function MarketingHome() {
  usePageMeta(TITLE, DESC);
  return (
    <div className="mk-page">
      <MarketingNav />
      <section className="mk-hero">
        <span className="brand-mark mk-logo">B</span>
        <span className="eyebrow">BOOKEASY</span>
        <h1>Όλες οι κρατήσεις σου. Σε ένα app.</h1>
        <p>{DESC}</p>
        <div className="mk-buttons">
          <Link className="primary-button" to="/install">
            Κατέβασε το BookEasy App
          </Link>
          <a className="outline-button" href="#how-it-works">
            Δες πώς λειτουργεί
          </a>
        </div>
      </section>

      <section className="mk-section" id="how-it-works">
        <h2>Πώς λειτουργεί</h2>
        <p>
          Ο επαγγελματίας ρυθμίζει υπηρεσίες και ωράριο, ο πελάτης κλείνει
          ραντεβού online και οι δύο ενημερώνονται αυτόματα.
        </p>
      </section>

      <section className="mk-section" id="professionals">
        <h2>Για επαγγελματίες</h2>
        <Cards items={PRO} />
        <p className="mk-note">
          Η πλήρης εμπειρία BookEasy είναι διαθέσιμη στην εφαρμογή. Ο
          λογαριασμός σου παραμένει προσβάσιμος και από το web.
        </p>
        <div className="mk-buttons">
          <Link className="outline-button" to="/login">Σύνδεση επαγγελματία</Link>
          <Link className="primary-button" to="/register">Εγγραφή επαγγελματία</Link>
        </div>
      </section>

      <section className="mk-section" id="customers">
        <h2>Για πελάτες</h2>
        <Cards items={CUSTOMERS} />
      </section>

      <section className="mk-section" id="ai">
        <h2>AI εξυπηρέτηση πελατών</h2>
        <p>
          Ο βοηθός AI του BookEasy βοηθά τους επαγγελματίες να απαντούν στις
          συχνές ερωτήσεις των πελατών τους και να οργανώνουν τη δουλειά τους.
        </p>
      </section>

      <section className="mk-section" id="notifications">
        <h2>Ειδοποιήσεις</h2>
        <p>
          Επιβεβαιώσεις ραντεβού, αλλαγές και υπενθυμίσεις, ώστε κανείς να μη
          χάνει το ραντεβού του.
        </p>
      </section>

      <section className="mk-section" id="pricing">
        <h2>Τιμές</h2>
        <div className="mk-grid">
          {PLANS.map(([name, desc]) => (
            <div className="panel mk-card" key={name}>
              <strong>{name}</strong>
              <p>{desc}</p>
              <Link className="primary-button" to="/register">
                Ξεκίνα
              </Link>
            </div>
          ))}
        </div>
        <p className="mk-note">
          Οι τιμές και η επιλογή πλάνου εμφανίζονται μετά την εγγραφή.
        </p>
      </section>

      <section className="mk-section" id="faq">
        <h2>FAQ</h2>
        <div className="mk-faq">
          {FAQ.map(([q, a]) => (
            <details key={q}>
              <summary>{q}</summary>
              <p>{a}</p>
            </details>
          ))}
        </div>
      </section>

      <InstallAppSection id="install" title="Κατέβασε το BookEasy App" />

      <footer className="mk-footer">
        <small>© {new Date().getFullYear()} BookEasy</small>
        <Link to="/customer-login">Είμαι πελάτης</Link>
      </footer>
    </div>
  );
}
