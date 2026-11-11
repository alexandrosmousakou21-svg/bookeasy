import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  Link,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import {
  Bell,
  ArrowUpRight,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Copy,
  CheckCheck,
  Check,
  CreditCard,
  Inbox,
  LayoutDashboard,
  LogOut,
  Mail,
  MapPin,
  Menu,
  MessageCircle,
  Plus,
  RefreshCw,
  Send,
  Scissors,
  Search,
  Settings,
  Sparkles,
  Stethoscope,
  Trash2,
  UserRound,
  Users,
  X,
} from "lucide-react";
import {
  supabase,
  isSupabaseConfigured,
  SUPABASE_CONFIG_ERROR,
} from "./lib/supabase";
import ErrorBoundary from "./ErrorBoundary";
import AppointmentRescheduleDialog from "./AppointmentRescheduleDialog";
import { reportCriticalError } from "./lib/errorReporting";
import { invokeWithRetry } from "./lib/functions";
import { safeReturnPath } from "./lib/returnPath";
import { ensureProfessionalBusiness, registrationAuthError, validateRegistration } from "./lib/registration";
import { supabaseErrorMessage } from "./lib/errorMessages";
import { matchesBusinessQuery } from "./lib/directorySearch";
import WeeklyActivity, { AnimatedNumber } from "./WeeklyActivity";
import { EmptyState, Skeleton, StatusDot, useConfirm, useToast } from "./ui";

const statusLabels = {
  booked: "Νέα κράτηση",
  pending: "Σε αναμονή",
  confirmed: "Επιβεβαιωμένο",
  completed: "Ολοκληρώθηκε",
  cancelled: "Ακυρώθηκε",
};

const customerModule = () => import("./customer");
const CustomerAppointmentsPage = lazy(() =>
  customerModule().then((module) => ({ default: module.CustomerAppointmentsPage })),
);
const CustomerAuth = lazy(() =>
  customerModule().then((module) => ({ default: module.CustomerAuth })),
);
const CustomerBooking = lazy(() =>
  customerModule().then((module) => ({ default: module.CustomerBooking })),
);
const CustomerHome = lazy(() =>
  customerModule().then((module) => ({ default: module.CustomerHome })),
);
const CustomerProfile = lazy(() =>
  customerModule().then((module) => ({ default: module.CustomerProfile })),
);
const CustomerSupportPage = lazy(() =>
  customerModule().then((module) => ({ default: module.CustomerSupportPage })),
);

const dayNames = [
  "Κυριακή",
  "Δευτέρα",
  "Τρίτη",
  "Τετάρτη",
  "Πέμπτη",
  "Παρασκευή",
  "Σάββατο",
];
const BOOKEASY_SUPPORT_EMAIL = (import.meta.env.VITE_BOOKEASY_SUPPORT_EMAIL || "").trim();
const WEB_PUSH_VAPID_PUBLIC_KEY = (import.meta.env.VITE_WEB_PUSH_VAPID_PUBLIC_KEY || "").trim();
function decodeVapidPublicKey(value) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}
const errorText = supabaseErrorMessage;
const slugify = (value) => {
  const greekMap = {
    ά: "a",
    έ: "e",
    ή: "i",
    ί: "i",
    ό: "o",
    ύ: "y",
    ώ: "o",
    α: "a",
    β: "v",
    γ: "g",
    δ: "d",
    ε: "e",
    ζ: "z",
    η: "i",
    θ: "th",
    ι: "i",
    κ: "k",
    λ: "l",
    μ: "m",
    ν: "n",
    ξ: "x",
    ο: "o",
    π: "p",
    ρ: "r",
    σ: "s",
    ς: "s",
    τ: "t",
    υ: "y",
    φ: "f",
    χ: "ch",
    ψ: "ps",
    ω: "o",
  };
  return (
    value
      .toLowerCase()
      .split("")
      .map((character) => greekMap[character] || character)
      .join("")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "business"
  );
};

function useAuth() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(isSupabaseConfigured);
  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return undefined;
    }
    let active = true;
    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (error) reportCriticalError(error, { feature: "authentication", operation: "load-session" });
        if (active) {
          setSession(data.session);
          setLoading(false);
        }
      })
      .catch((error) => {
        reportCriticalError(error, { feature: "authentication", operation: "load-session" });
        if (active) setLoading(false);
      });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) =>
      setSession(next),
    );
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);
  return { session, user: session?.user || null, loading };
}
function useData(table, id, options = {}) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(Boolean(id && isSupabaseConfigured));
  const [error, setError] = useState(
    isSupabaseConfigured ? "" : SUPABASE_CONFIG_ERROR,
  );
  const reload = async () => {
    if (!supabase) {
      setError(SUPABASE_CONFIG_ERROR);
      return;
    }
    if (!id) {
      setData([]);
      setLoading(false);
      return [];
    }
    setLoading(true);
    try {
      const { data: rows, error: requestError } = await supabase
        .from(table)
        .select(options.select || "*")
        .eq(options.column || "business_id", id)
        .order(options.order || "created_at", {
          ascending: options.order === "day_of_week" || options.order === "name",
        });
      if (requestError) {
        reportCriticalError(requestError, {
          feature: "supabase-data",
          operation: `load-${table}`,
        });
      }
      setError(requestError ? errorText(requestError) : "");
      setData(rows || []);
      return rows || [];
    } catch (requestError) {
      reportCriticalError(requestError, {
        feature: "supabase-data",
        operation: `load-${table}`,
      });
      setError("Δεν ήταν δυνατή η φόρτωση των στοιχείων. Δοκιμάστε ξανά.");
      setData([]);
      return [];
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    reload();
  }, [id]);
  return { data, setData, loading, error, reload };
}
function Loading() {
  return (
    <div className="loading-state">
      <div className="loader" />
      <span>Φόρτωση...</span>
    </div>
  );
}
function Notice({ message, success = false }) {
  return message ? (
    <div className={`notice ${success ? "success" : ""}`}>{message}</div>
  ) : null;
}
function DataFailure({ store }) {
  return (
    <div role="alert">
      <Notice message={store.error} />
      <button type="button" className="outline-button" onClick={store.reload}>Επανάληψη</button>
    </div>
  );
}
function Protected({ children }) {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    if (!loading && (!isSupabaseConfigured || !user))
      navigate("/login", { replace: true });
  }, [loading, user, navigate]);
  if (loading) return <Loading />;
  if (!isSupabaseConfigured)
    return <div className="loading-state"><Notice message={SUPABASE_CONFIG_ERROR} /></div>;
  if (!user) return null;
  return children;
}
function CustomerAuthRedirect({ mode }) {
  const auth = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    const returnTo = new URLSearchParams(window.location.search).get(
      "returnTo",
    );
    if (returnTo !== null) {
      try {
        const safePath = safeReturnPath(returnTo, null);
        if (safePath) sessionStorage.setItem("bookeasy-return-to", safePath);
        else sessionStorage.removeItem("bookeasy-return-to");
      } catch {
        // The login form also carries returnTo in its URL.
      }
    }
  }, []);
  useEffect(() => {
    let returnTo = null;
    try {
      returnTo = sessionStorage.getItem("bookeasy-return-to");
    } catch {
      // Authentication can proceed without session storage.
    }
    if (auth.user && returnTo) {
      try {
        sessionStorage.removeItem("bookeasy-return-to");
      } catch {
        // No persisted redirect to clean up.
      }
      navigate(safeReturnPath(returnTo), { replace: true });
    }
  }, [auth.user, navigate]);
  return <CustomerAuth mode={mode} />;
}

function RouteBoundary({ children }) {
  return <ErrorBoundary>{children}</ErrorBoundary>;
}

function App() {
  const auth = useAuth();
  const [business, setBusiness] = useState(null);
  const [businessLoading, setBusinessLoading] = useState(true);
  const [businessError, setBusinessError] = useState("");
  useEffect(() => {
    let active = true;
    async function load() {
      if (!isSupabaseConfigured) {
        setBusinessError(SUPABASE_CONFIG_ERROR);
        setBusinessLoading(false);
        return;
      }
      if (!auth.user) {
        setBusinessLoading(false);
        return;
      }
      try {
        const { data, error } = await supabase
          .from("businesses")
          .select("*")
          .eq("owner_id", auth.user.id)
          .maybeSingle();
        if (error) reportCriticalError(error, { feature: "business-dashboard", operation: "load-business" });
        if (active) {
          setBusiness(data);
          setBusinessError(error ? errorText(error) : "");
        }
      } catch (error) {
        reportCriticalError(error, { feature: "business-dashboard", operation: "load-business" });
        if (active) {
          setBusiness(null);
          setBusinessError("Δεν ήταν δυνατή η φόρτωση της επιχείρησης. Δοκιμάστε ξανά.");
        }
      } finally {
        if (active) setBusinessLoading(false);
      }
    }
    load();
    return () => {
      active = false;
    };
  }, [auth.user]);
  const logout = async () => {
    if (supabase) await supabase.auth.signOut();
    setBusiness(null);
  };
  return (
    <Suspense fallback={<Loading />}>
    <Routes>
      <Route path="/" element={<RouteBoundary><HomePage business={business} user={auth.user} /></RouteBoundary>} />
      <Route path="/login" element={<RouteBoundary><AuthPage mode="login" /></RouteBoundary>} />
      <Route path="/register" element={<RouteBoundary><AuthPage mode="register" /></RouteBoundary>} />
      <Route path="/customer" element={<RouteBoundary><CustomerHome /></RouteBoundary>} />
      <Route
        path="/customer-login"
        element={<RouteBoundary><CustomerAuthRedirect mode="login" /></RouteBoundary>}
      />
      <Route
        path="/customer-register"
        element={<RouteBoundary><CustomerAuthRedirect mode="register" /></RouteBoundary>}
      />
      <Route path="/customer/profile" element={<RouteBoundary><CustomerProfile /></RouteBoundary>} />
      <Route path="/customer/support" element={<RouteBoundary><CustomerSupportPage /></RouteBoundary>} />
      <Route path="/book/:slug" element={<RouteBoundary><CustomerBooking /></RouteBoundary>} />
      <Route path="/b/:slug" element={<RouteBoundary><CustomerBooking /></RouteBoundary>} />
      <Route path="/my-appointments" element={<RouteBoundary><CustomerAppointmentsPage /></RouteBoundary>} />
      <Route
        path="/dashboard/*"
        element={
          <RouteBoundary>
            <Protected>
              <Dashboard
                business={business}
                setBusiness={setBusiness}
                businessLoading={businessLoading}
                businessError={businessError}
                logout={logout}
              />
            </Protected>
          </RouteBoundary>
        }
      />
      <Route path="*" element={<RouteBoundary><NavigateHome user={auth.user} /></RouteBoundary>} />
    </Routes>
    </Suspense>
  );
}
function HomePage({ business, user }) {
  const [authModal, setAuthModal] = useState(null);

  const previewAppointments = [
    { time: "09:00", name: "Μαρία Κ.", service: "Κούρεμα", duration: "30′", color: "mint" },
    { time: "10:00", name: "Νίκος Π.", service: "Περιποίηση", duration: "45′", color: "gold" },
    { time: "11:30", name: "Ελένη Δ.", service: "Κούρεμα & styling", duration: "60′", color: "sage" },
    { time: "13:00", name: "Γιώργος Μ.", service: "Ραντεβού", duration: "30′", color: "mint" },
  ];

  return (
    <div className="home-layout home-premium-minimal">
      <header className="home-header">
        <Link className="brand light home-brand" to="/" aria-label="BookEasy αρχική">
          <span className="brand-mark">B</span>
          <span>book<span>easy</span></span>
        </Link>

        <div className="home-header-actions">
          <button type="button" className="home-login" onClick={() => setAuthModal("login")}>
            Σύνδεση
          </button>
          <button type="button" className="home-nav-cta" onClick={() => setAuthModal("register")}>
            Για επαγγελματίες <ArrowUpRight size={15} />
          </button>
        </div>
      </header>

      <main className="home-minimal-main home-showcase">
        <section className="home-hero" aria-labelledby="home-title">
          <div className="home-hero-copy">
            <span className="home-kicker">
              <span /> BOOKEASY · YOUR TIME, YOUR BUSINESS
            </span>
            <h1 id="home-title">
              Τα ραντεβού σου,<br />
              <em>πιο εύκολα από ποτέ.</em>
            </h1>
            <p>
              Όλα τα ραντεβού της επιχείρησής σου σε ένα σημείο.
              Οργάνωσε το πρόγραμμά σου και άφησε τους πελάτες σου
              να κλείνουν online, εύκολα και γρήγορα.
            </p>
            <div className="home-showcase-actions">
              <button type="button" className="home-primary-cta" onClick={() => setAuthModal("register")}>
                Ξεκίνα δωρεάν <ArrowUpRight size={16} />
              </button>
              <span><Check size={15} /> Απλή οργάνωση. Περισσότερος χρόνος.</span>
            </div>
          </div>

          <div className="home-product-preview" aria-label="Προεπισκόπηση ημερολογίου BookEasy">
            <div className="home-preview-topline">
              <span className="home-preview-live"><i /> LIVE PREVIEW</span>
              <span>BOOKEASY DASHBOARD</span>
            </div>

            <div className="home-preview-window">
              <aside className="home-preview-sidebar">
                <div className="home-preview-brand"><span>B</span> bookeasy</div>
                <div className="home-preview-nav active"><CalendarDays size={15} /> Ημερολόγιο</div>
                <div className="home-preview-nav"><Users size={15} /> Πελάτες</div>
                <div className="home-preview-nav"><Clock3 size={15} /> Διαθεσιμότητα</div>
                <div className="home-preview-sidebar-bottom">Ο χώρος εργασίας σου</div>
              </aside>

              <div className="home-preview-main">
                <div className="home-preview-heading">
                  <div>
                    <span>Ο ΧΩΡΟΣ ΕΡΓΑΣΙΑΣ ΣΟΥ</span>
                    <h3>Το πρόγραμμά σου</h3>
                    <p>Μια καθαρή εικόνα της ημέρας σου.</p>
                  </div>
                  <div className="home-preview-avatar">B</div>
                </div>

                <div className="home-preview-stats">
                  <div><span>Σημερινά ραντεβού</span><strong>08</strong><small>Στο πρόγραμμά σου</small></div>
                  <div><span>Ολοκληρωμένα</span><strong>03</strong><small>Μέχρι στιγμής</small></div>
                  <div><span>Επόμενο ραντεβού</span><strong>09:00</strong><small>Σε λίγο ξεκινά</small></div>
                </div>

                <div className="home-preview-calendar">
                  <div className="home-preview-calendar-head">
                    <div><strong>Εβδομαδιαίο πρόγραμμα</strong><small>Δευτέρα – Παρασκευή</small></div>
                    <div className="home-preview-arrows"><span><ChevronLeft size={13} /></span><span><ChevronRight size={13} /></span></div>
                  </div>
                  <div className="home-preview-days">
                    <span>ΩΡΑ</span><span>ΔΕΥ</span><span className="today">ΤΡΙ</span><span>ΤΕΤ</span><span>ΠΕΜ</span><span>ΠΑΡ</span>
                  </div>
                  <div className="home-preview-schedule">
                    <div className="home-preview-times"><span>09:00</span><span>10:00</span><span>11:00</span><span>12:00</span><span>13:00</span></div>
                    <div className="home-preview-events">
                      {previewAppointments.map((item) => (
                        <div className={`home-preview-event ${item.color}`} key={item.time}>
                          <b>{item.time} · {item.name}</b>
                          <span>{item.service}</span>
                        </div>
                      ))}
                      <div className="home-preview-current-time"><i /> ΤΩΡΑ</div>
                    </div>
                  </div>
                </div>
                <div className="home-preview-footer"><span><i /> Το πρόγραμμά σου με μια ματιά</span><span>ΠΡΟΕΠΙΣΚΟΠΗΣΗ</span></div>
              </div>
            </div>
            <div className="home-preview-caption">Ένα οργανωμένο πρόγραμμα. Όλα σε ένα μέρος.</div>
          </div>
        </section>
      </main>

      {authModal && (
        <AuthModal
          mode={authModal}
          onClose={() => setAuthModal(null)}
          onModeChange={setAuthModal}
        />
      )}
    </div>
  );
}
function NavigateHome({ user }) {
  const navigate = useNavigate();

  useEffect(() => {
    if (!user) {
      navigate("/login", { replace: true });
      return;
    }

    if (user.user_metadata?.account_type === "customer") {
      navigate("/customer", { replace: true });
      return;
    }

    navigate("/dashboard", { replace: true });
  }, [navigate, user]);

  return null;
}

const navItems = [
  ["/", "Επισκόπηση", LayoutDashboard],
  ["/dashboard/calendar", "Ημερολόγιο", CalendarDays],
  ["/dashboard/appointments", "Ραντεβού", Clock3],
  ["/dashboard/customers", "Πελάτες", Users],
  ["/dashboard/services", "Υπηρεσίες", Scissors],
  ["/dashboard/staff", "Ομάδα", UserRound],
  ["/dashboard/profile", "Προφίλ επιχείρησης", Sparkles],
  ["/dashboard/ai", "Εξυπηρέτηση Πελατών", Sparkles],
  ["/dashboard/plan", "Πλάνο", CreditCard],
  ["/dashboard/settings", "Ρυθμίσεις", Settings],
];
function Dashboard({
  business,
  setBusiness,
  businessLoading,
  businessError,
  logout,
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem("bookeasy-sidebar-collapsed") === "true";
    } catch {
      return false;
    }
  });
  const toggleCollapsed = () => {
    setCollapsed((current) => {
      try {
        localStorage.setItem("bookeasy-sidebar-collapsed", String(!current));
      } catch {
        // The layout preference is optional.
      }
      return !current;
    });
  };
  const location = useLocation();
  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);
  const page =
    navItems.find(
      (item) => item[0] !== "/" && location.pathname === item[0],
    )?.[1] || "Επισκόπηση";
  const appointments = useData("appointments", business?.id, {
    select: "*, service:services(name,duration_minutes,price), staff:staff(name)",
  });
  const hours = useData("working_hours", business?.id, {
    order: "day_of_week",
  });
  const support = useData("customer_support_conversations", business?.id, {
    select: "id,unread_for_business,updated_at",
    order: "updated_at",
  });
  useEffect(() => {
    if (!supabase || !business?.id) return undefined;
    const channel = supabase
      .channel(`support-badge-${business.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "customer_support_conversations",
          filter: `business_id=eq.${business.id}`,
        },
        () => support.reload(),
      )
      .subscribe();
    const refresh = window.setInterval(() => support.reload(), 30000);
    return () => {
      window.clearInterval(refresh);
      supabase.removeChannel(channel);
    };
  }, [business?.id]);
  useEffect(() => {
    if (!supabase || !business?.id) return undefined;
    const channel = supabase
      .channel(`professional-appointments-${business.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "appointments",
          filter: `business_id=eq.${business.id}`,
        },
        () => appointments.reload(),
      )
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [business?.id]);
  useEffect(() => {
    if (!supabase || !business?.id) return undefined;
    const channel = supabase
      .channel(`professional-availability-${business.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "working_hours", filter: `business_id=eq.${business.id}` }, () => hours.reload())
      .on("postgres_changes", { event: "*", schema: "public", table: "working_hour_breaks", filter: `business_id=eq.${business.id}` }, () => hours.reload())
      .on("postgres_changes", { event: "*", schema: "public", table: "availability_exceptions", filter: `business_id=eq.${business.id}` }, () => hours.reload())
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [business?.id]);
  if (businessLoading) return <Loading />;
  if (businessError || !business)
    return (
      <div className="loading-state">
        <Notice
          message={
            businessError || "Δεν βρέθηκε επιχείρηση για αυτόν τον λογαριασμό."
          }
        />
        <Link className="primary-button" to="/register">
          Δημιουργία επιχείρησης
        </Link>
      </div>
    );
  return (
    <div className={`app-shell${collapsed ? " is-collapsed" : ""}`}>
      {sidebarOpen && <div className="sidebar-scrim" onClick={() => setSidebarOpen(false)} aria-hidden="true" />}
      <aside id="dashboard-sidebar" className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="sidebar-top">
          <Link className="brand" to="/dashboard">
            <span className="brand-mark">B</span>
            <span className="brand-text">
              book<span>easy</span>
            </span>
          </Link>
          <button
            className="icon-button mobile-only"
            aria-label="Κλείσιμο μενού"
            onClick={() => setSidebarOpen(false)}
          >
            <X size={18} />
          </button>
          <button
            className="icon-button sidebar-collapse desktop-only"
            aria-label={collapsed ? "Επέκταση πλαϊνής μενού" : "Σύμπτυξη πλαϊνής μενού"}
            aria-expanded={!collapsed}
            aria-controls="dashboard-sidebar"
            onClick={toggleCollapsed}
          >
            <ChevronLeft size={17} />
          </button>
        </div>
        <div className="workspace-switcher">
          <div className="workspace-logo">{business.name[0]}</div>
          <div>
            <strong>{business.name}</strong>
            <small>Ο χώρος εργασίας μου</small>
          </div>
          <ChevronDown size={15} />
        </div>
        <nav>
          <small className="nav-caption">ΧΩΡΟΣ ΕΡΓΑΣΙΑΣ</small>
          {navItems.map(([to, label, Icon]) => (
            <NavLink
              key={label}
              to={to === "/" ? "/dashboard" : to}
              end={to === "/"}
              className={({ isActive }) =>
                `nav-item ${isActive ? "active" : ""}`
              }
              onClick={() => setSidebarOpen(false)}
            >
              <Icon size={17} />
              <span className="nav-label">{label}</span>
              {label === "Ραντεβού" && !appointments.loading && !appointments.error && <b>{appointments.data.length}</b>}
              {label === "Εξυπηρέτηση Πελατών" &&
                support.data.some((item) => item.unread_for_business) && (
                  <b>
                    {support.data.filter((item) => item.unread_for_business).length}
                  </b>
                )}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <Link to={`/b/${business.slug}`} className="public-link">
            <span>Δημόσια σελίδα</span>
            <ChevronRight size={15} />
          </Link>
          <button className="user-row logout-button" onClick={logout}>
            <div className="avatar navy">{business.name.slice(0, 2)}</div>
            <div>
              <strong>Λογαριασμός</strong>
              <small>Αποσύνδεση</small>
            </div>
            <LogOut size={16} />
          </button>
        </div>
      </aside>
      <main className="main-content">
        <header className="topbar">
          <button
            className="icon-button mobile-only"
            aria-label="Άνοιγμα μενού"
            aria-controls="dashboard-sidebar"
            aria-expanded={sidebarOpen}
            onClick={() => setSidebarOpen(true)}
          >
            <Menu size={20} />
          </button>
          <div className="breadcrumbs">
            <span>Χώρος εργασίας</span>
            <ChevronRight size={14} />
            <strong>{page}</strong>
          </div>
          <div className="top-actions">
            <div className="connection-dot">
              <i />{" "}
              Συνδεδεμένο
            </div>
            <Link className="primary-button compact" to={`/b/${business.slug}`}>
              <Plus size={16} /> Νέο ραντεβού
            </Link>
            <div className="avatar blue">{business.name.slice(0, 2)}</div>
          </div>
        </header>
        <div className="content" key={location.pathname}>
          <Routes>
            <Route
              index
              element={
                <Overview
                  business={business}
                  appointments={appointments}
                  hours={hours}
                />
              }
            />
            <Route
              path="calendar"
              element={<Calendar appointments={appointments} />}
            />
            <Route
              path="appointments"
              element={<Appointments appointments={appointments} />}
            />
            <Route
              path="customers"
              element={<Customers business={business} />}
            />
            <Route path="services" element={<Services business={business} />} />
            <Route path="staff" element={<Staff business={business} />} />
            <Route
              path="ai"
              element={
                <AIAssistant
                  business={business}
                  appointments={appointments}
                  hours={hours}
                />
              }
            />
            <Route
              path="profile"
              element={<Profile business={business} setBusiness={setBusiness} />}
            />
            <Route path="plan" element={<PlanPage business={business} />} />
            <Route path="settings" element={<SettingsPage business={business} />} />
          </Routes>
        </div>
      </main>
      <nav className="tab-bar" aria-label="Κύρια πλοηγήση">
        {[navItems[0], navItems[1], navItems[2], navItems[4]].map(([to, label, Icon]) => (
          <NavLink
            key={label}
            to={to === "/" ? "/dashboard" : to}
            end={to === "/"}
            className={({ isActive }) => `tab-item${isActive ? " active" : ""}`}
          >
            <Icon size={20} />
            <span>{label}</span>
          </NavLink>
        ))}
        <button type="button" className="tab-item" aria-expanded={sidebarOpen} aria-controls="dashboard-sidebar" onClick={() => setSidebarOpen(true)}>
          <Menu size={20} />
          <span>Μενού</span>
        </button>
      </nav>
    </div>
  );
}

function ProfileRedirect({ business }) {
  const navigate = useNavigate();

  useEffect(() => {
    if (business?.slug) {
      navigate(`/b/${business.slug}?from=dashboard`, { replace: true });
    }
  }, [business?.slug, navigate]);

  return null;
}

function PageHeader({ eyebrow, title, subtitle, action }) {
  return (
    <div className="page-header">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      {action && <div className="page-header-actions">{action}</div>}
    </div>
  );
}

function ProfessionalNotificationsBell({ business, user }) {
  const [items, setItems] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(Boolean(business?.id && user?.id));
  const [open, setOpen] = useState(false);
  const [notificationError, setNotificationError] = useState("");
  const [pushError, setPushError] = useState("");
  const [pushMessage, setPushMessage] = useState("");
  const [pushWorking, setPushWorking] = useState(false);
  const promptAttempted = useRef(false);

  const loadNotifications = async () => {
    if (!supabase || !business?.id || !user?.id) {
      setItems([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setNotificationError("");
      const [listResult, countResult] = await Promise.all([
        supabase
          .from("professional_notifications")
          .select("id,title,body,category,event_type,read_at,created_at")
          .eq("business_id", business.id)
          .eq("recipient_user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(10),
        supabase
          .from("professional_notifications")
          .select("id", { count: "exact", head: true })
          .eq("business_id", business.id)
          .eq("recipient_user_id", user.id)
          .is("read_at", null),
      ]);
      if (listResult.error) throw listResult.error;
      if (countResult.error) throw countResult.error;
      setItems(listResult.data || []);
      setUnreadCount(countResult.count || 0);
    } catch (requestError) {
      reportCriticalError(requestError, {
        feature: "professional-notifications",
        operation: "load-notifications",
      });
      setNotificationError("Δεν ήταν δυνατή η φόρτωση των ειδοποιήσεων. Δοκιμάστε ξανά.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadNotifications();
    if (!supabase || !business?.id || !user?.id) return undefined;

    const channel = supabase
      .channel(`professional-notifications-${business.id}-${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "professional_notifications",
          filter: `recipient_user_id=eq.${user.id}`,
        },
        () => loadNotifications(),
      )
      .subscribe();

    const refresh = window.setInterval(loadNotifications, 30000);
    return () => {
      window.clearInterval(refresh);
      supabase.removeChannel(channel);
    };
  }, [business?.id, user?.id]);

  const markAllAsRead = async () => {
    if (!unreadCount || !supabase) return;

    const readAt = new Date().toISOString();
    const { error } = await supabase
      .from("professional_notifications")
      .update({ read_at: readAt })
      .eq("business_id", business.id)
      .eq("recipient_user_id", user.id)
      .is("read_at", null);

    if (error) {
      reportCriticalError(error, {
        feature: "professional-notifications",
        operation: "mark-read",
      });
      setNotificationError("Δεν ήταν δυνατή η ενημέρωση των ειδοποιήσεων.");
      return;
    }

    setItems((current) => current.map((item) => ({ ...item, read_at: item.read_at || readAt })));
    setUnreadCount(0);
  };

  const registerPush = async () => {
    setPushError("");
    setPushMessage("");
    if (!WEB_PUSH_VAPID_PUBLIC_KEY) {
      setPushError("Οι ειδοποιήσεις push δεν είναι ρυθμισμένες ακόμη.");
      return;
    }
    if (!supabase || !business?.id || !user?.id ||
      !("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      setPushError("Οι ειδοποιήσεις push δεν υποστηρίζονται σε αυτή τη συσκευή ή περιήγηση.");
      return;
    }

    setPushWorking(true);
    try {
      let permission = Notification.permission;
      if (permission === "default") {
        const promptKey = `bookeasy-push-prompted:${business.id}`;
        let wasPrompted = promptAttempted.current;
        try {
          wasPrompted ||= localStorage.getItem(promptKey) === "true";
        } catch {
          // The component ref still prevents repeated prompts in this page session.
        }
        if (wasPrompted) {
          setPushError("Η άδεια δεν θα ζητηθεί ξανά αυτόματα. Ελέγξτε τις ρυθμίσεις ειδοποιήσεων του browser.");
          return;
        }
        promptAttempted.current = true;
        try {
          localStorage.setItem(promptKey, "true");
        } catch {
          // Permission is still requested only from this explicit button action.
        }
        permission = await Notification.requestPermission();
      }
      if (permission !== "granted") {
        setPushError(permission === "denied"
          ? "Οι ειδοποιήσεις έχουν αποκλειστεί στις ρυθμίσεις του browser."
          : "Δεν δόθηκε άδεια για ειδοποιήσεις.");
        return;
      }

      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription() ||
        await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: decodeVapidPublicKey(WEB_PUSH_VAPID_PUBLIC_KEY),
        });
      const serialized = subscription.toJSON();
      const expirationTime = subscription.expirationTime;
      const { error } = await supabase.rpc("save_professional_push_subscription", {
        target_business: business.id,
        target_endpoint: serialized.endpoint,
        target_p256dh: serialized.keys?.p256dh,
        target_auth: serialized.keys?.auth,
        target_expiration: expirationTime ? new Date(expirationTime).toISOString() : null,
      });
      if (error) throw error;
      setPushMessage("Οι ειδοποιήσεις push ενεργοποιήθηκαν.");
    } catch (requestError) {
      reportCriticalError(requestError, {
        feature: "professional-notifications",
        operation: "register-push-subscription",
      });
      setPushError("Δεν ήταν δυνατή η ενεργοποίηση των ειδοποιήσεων push. Το dashboard παραμένει διαθέσιμο.");
    } finally {
      setPushWorking(false);
    }
  };

  return (
    <div className="notification-bell-wrap">
      <button
        type="button"
        className="icon-button notification-bell"
        onClick={() => setOpen((current) => !current)}
        aria-label="Ειδοποιήσεις επαγγελματία"
        aria-expanded={open}
      >
        <Bell size={17} />
        {unreadCount > 0 && (
          <span className="notification-badge">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>
      {open && (
        <div className="notification-popover" role="dialog" aria-label="Κέντρο ειδοποιήσεων">
          <div className="notification-header">
            <strong>Ειδοποιήσεις</strong>
            {unreadCount > 0 && (
              <button type="button" className="notification-action" onClick={markAllAsRead}>
                Σήμανση ως αναγνωσμένες
              </button>
            )}
          </div>
          {notificationError && <div className="notification-error" role="alert">{notificationError}</div>}
          {loading ? (
            <div className="notification-empty">Φόρτωση...</div>
          ) : notificationError ? null : items.length ? (
            items.map((item) => (
              <div key={item.id} className={`notification-item ${item.read_at ? "read" : "unread"}`}>
                <strong>{item.title}</strong>
                <p>{item.body}</p>
                <small>{new Date(item.created_at).toLocaleString("el-GR")}</small>
              </div>
            ))
          ) : (
            <div className="notification-empty">Δεν υπάρχουν ειδοποιήσεις για αυτήν τη στιγμή.</div>
          )}
          <div className="notification-push-settings">
            <button type="button" className="notification-action" onClick={registerPush} disabled={pushWorking}>
              {pushWorking ? "Ενεργοποίηση..." : "Ενεργοποίηση push ειδοποιήσεων"}
            </button>
            {pushError && <p className="notification-error" role="alert">{pushError}</p>}
            {pushMessage && <p className="notification-success" role="status">{pushMessage}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
function StatCard({ icon: Icon, label, value, trend, tone, loading }) {
  return (
    <article className="stat-card">
      <div className={`stat-icon ${tone}`}>
        <Icon size={18} />
      </div>
      <div>
        <span>{label}</span>
        {loading ? <span className="stat-skeleton" role="status" aria-label="Φόρτωση" /> : <AnimatedNumber value={value} />}
        <small className="trend">{trend}</small>
      </div>
    </article>
  );
}
function Overview({ appointments, business, hours }) {
  const { user } = useAuth();
  const professionalName =
    user?.user_metadata?.full_name ||
    user?.user_metadata?.first_name ||
    business.name;
  const today = new Date().toISOString().slice(0, 10);
  const todayItems = appointments.data.filter(
    (appointment) => appointment.appointment_date === today,
  );
  const items = todayItems.slice(0, 4);
  const weekStart = new Date(`${today}T00:00:00`);
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);
  const weekItems = appointments.data.filter((appointment) => {
    const appointmentDate = new Date(`${appointment.appointment_date}T12:00:00`);
    return appointmentDate >= weekStart && appointmentDate < weekEnd;
  });
  const customerCount = new Set(
    appointments.data.map((appointment) => appointment.customer_id).filter(Boolean),
  ).size;
  const serviceCount = new Set(
    appointments.data.map((appointment) => appointment.service_id).filter(Boolean),
  ).size;
  const [copied, setCopied] = useState(false);
  const publicUrl = `${window.location.origin}/b/${business.slug}`;
  const copyPublicUrl = async () => {
    await navigator.clipboard?.writeText(publicUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };
  const sharePublicUrl = async () => {
    if (navigator.share) {
      await navigator.share({
        title: business.name,
        text: "Κλείσε το ραντεβού σου online",
        url: publicUrl,
      });
    } else {
      await copyPublicUrl();
    }
  };
  return (
    <>
      <PageHeader
        eyebrow="ΣΗΜΕΡΑ"
        title={`Καλημέρα, ${professionalName}`}
        subtitle={`Μια γρήγορη ματιά στο ${business.name} σήμερα.`}
        action={
          <>
            <ProfessionalNotificationsBell business={business} user={user} />
            <Link className="primary-button" to={`/b/${business.slug}`}>
              <Plus size={17} /> Νέο ραντεβού
            </Link>
          </>
        }
      />
      {appointments.error && !appointments.loading ? <DataFailure store={appointments} /> : <>
      <div className="stats-grid">
        <StatCard
          icon={CalendarDays}
          label="Σημερινά ραντεβού"
          value={todayItems.length}
          loading={appointments.loading}
          trend="Ενημερωμένα από τη βάση"
          tone="blue"
        />
        <StatCard
          icon={Users}
          label="Πελάτες με ραντεβού"
          value={customerCount}
          loading={appointments.loading}
          trend="Με ραντεβού"
          tone="green"
        />
        <StatCard
          icon={Scissors}
          label="Υπηρεσίες σε ραντεβού"
          value={serviceCount}
          loading={appointments.loading}
          trend="Σε ραντεβού"
          tone="orange"
        />
        <StatCard
          icon={Clock3}
          label="Ραντεβού εβδομάδας"
          value={weekItems.length}
          loading={appointments.loading}
          trend="Συνολικές κρατήσεις"
          tone="violet"
        />
      </div>
      <WeeklyActivity appointments={weekItems} weekStart={weekStart} loading={appointments.loading} />
      <QuickActions business={business} />
      <Insights appointments={appointments} />
      </>}
      <div className="dashboard-grid">
        <section className="panel schedule">
          <div className="panel-heading">
            <div>
              <h2>Σημερινό πρόγραμμα</h2>
              <p>
                {appointments.loading
                  ? "Φόρτωση..."
                  : appointments.error ? "Το πρόγραμμα δεν είναι διαθέσιμο." : `${todayItems.length} ραντεβού για σήμερα`}
              </p>
            </div>
            <Link to="/dashboard/calendar" className="text-link">
              Προβολή ημερολογίου <ChevronRight size={15} />
            </Link>
          </div>
          {appointments.loading ? (
            <Loading />
          ) : appointments.error ? null : (
            <div className="appointment-list">
              {items.map((appointment) => (
                <AppointmentRow
                  key={appointment.id}
                  appointment={appointment}
                />
              ))}
            </div>
          )}
        </section>
        <section className="panel availability">
          <div className="panel-heading">
            <div>
              <h2>Διαθεσιμότητα</h2>
              <p>Οι ώρες λειτουργίας σας</p>
            </div>
            <Settings size={18} className="muted" />
          </div>
          {hours.loading ? <Loading /> : hours.error ? <DataFailure store={hours} /> : <>
          <div className="hours-list">
            {hours.data
              .filter((day) => !day.staff_id)
              .slice(0, 5)
              .map((day) => (
              <div key={day.id || day.day_of_week}>
                <span>{dayNames[day.day_of_week]}</span>
                <strong>
                  {day.is_closed
                    ? "Κλειστά"
                    : `${day.start_time} – ${day.end_time}`}
                </strong>
              </div>
            ))}
          </div>
          <Link to="/dashboard/profile" className="outline-button">
            Επεξεργασία ωραρίου <ChevronRight size={15} />
          </Link>
          </>}
        </section>
      </div>
      <section className="link-banner">
        <div className="link-art">
          <div>↗</div>
        </div>
        <div>
          <span className="eyebrow">ΤΟ LINK ΤΩΝ ΡΑΝΤΕΒΟΥ ΣΑΣ</span>
          <h2>Μοιραστείτε το link σας</h2>
          <p>{publicUrl}</p>
        </div>
        <div className="booking-url">
          <span>{publicUrl}</span>
          <button className="outline-button" onClick={copyPublicUrl}>
            {copied ? "✓ Αντιγράφηκε" : "Αντιγραφή συνδέσμου"}
          </button>
          <button className="outline-button" onClick={sharePublicUrl}>
            Κοινοποίηση
          </button>
          <a
            className="text-link"
            href={publicUrl}
            target="_blank"
            rel="noreferrer"
          >
            Άνοιγμα σελίδας <ChevronRight size={15} />
          </a>
        </div>
      </section>
    </>
  );
}

function QuickActions({ business }) {
  const actions = [
    [`/b/${business.slug}`, Plus, "Νέο ραντεβού"],
    ["/dashboard/services", Scissors, "Υπηρεσίες"],
    ["/dashboard/staff", UserRound, "Ομάδα"],
    ["/dashboard/profile", Clock3, "Ωράριο και προφίλ"],
  ];
  return (
    <nav className="quick-actions" aria-label="Γρήγορες ενέργειες">
      {actions.map(([to, Icon, label]) => (
        <Link key={to} to={to} className="quick-action">
          <Icon size={16} /> {label}
        </Link>
      ))}
    </nav>
  );
}

function relativeTime(value) {
  const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60000);
  if (!Number.isFinite(minutes)) return "";
  if (minutes < 1) return "Τώρα";
  if (minutes < 60) return `${minutes} λεπτά πριν`;
  if (minutes < 1440) return `${Math.round(minutes / 60)} ώρες πριν`;
  return `${Math.round(minutes / 1440)} ημέρες πριν`;
}

// Every figure is derived from the loaded appointments; nothing here is stored or simulated.
function Insights({ appointments }) {
  if (appointments.loading) {
    return (
      <div className="insights-grid">
        {[0, 1, 2].map((index) => <section className="panel" key={index}><Skeleton lines={4} /></section>)}
      </div>
    );
  }
  const items = appointments.data;
  const now = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const monthItems = items.filter((item) => item.appointment_date?.startsWith(monthKey));
  const monthActive = monthItems.filter((item) => item.status !== "cancelled");
  const bookedValue = monthActive.reduce((sum, item) => sum + Number(item.service?.price || 0), 0);
  const cancelRate = monthItems.length ? Math.round((monthItems.length - monthActive.length) / monthItems.length * 100) : 0;

  const perCustomer = new Map();
  items.filter((item) => item.status !== "cancelled" && item.customer_id).forEach((item) => {
    perCustomer.set(item.customer_id, (perCustomer.get(item.customer_id) || 0) + 1);
  });
  const monthCustomers = new Set(monthActive.map((item) => item.customer_id).filter(Boolean));
  const returning = [...monthCustomers].filter((id) => perCustomer.get(id) > 1).length;
  const fresh = monthCustomers.size - returning;

  const weekStart = new Date(now);
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
  const staffCounts = new Map();
  items.filter((item) => item.status !== "cancelled" && new Date(item.starts_at) >= weekStart).forEach((item) => {
    const name = item.staff?.name || "Χωρίς ανάθεση";
    staffCounts.set(name, (staffCounts.get(name) || 0) + 1);
  });
  const staffRows = [...staffCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const staffMax = Math.max(1, ...staffRows.map(([, count]) => count));

  const upcoming = items
    .filter((item) => item.status !== "cancelled" && new Date(item.starts_at) > now)
    .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at))
    .slice(0, 5);
  const recent = [...items]
    .filter((item) => item.created_at)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 5);

  return (
    <>
      <div className="insights-grid">
        <section className="panel insight">
          <div className="panel-heading"><div><h2>Αξία κρατήσεων</h2><p>Τρέχων μήνας</p></div></div>
          <strong className="insight-figure">{bookedValue.toLocaleString("el-GR", { style: "currency", currency: "EUR" })}</strong>
          <p className="insight-note">Αξία ενεργών κρατήσεων βάσει τιμών υπηρεσιών. Δεν αποτυπώνει πληρωμές.</p>
          <div className="insight-meta"><span>{monthActive.length} ενεργές κρατήσεις</span><span>{cancelRate}% ακυρώσεις</span></div>
        </section>
        <section className="panel insight">
          <div className="panel-heading"><div><h2>Πελάτες μήνα</h2><p>Νέοι ή επαναλαμβανόμενοι</p></div></div>
          <strong className="insight-figure">{monthCustomers.size}</strong>
          <div className="split-bar" role="img" aria-label={`${fresh} νέοι, ${returning} παλιοί πελάτες`}>
            <span style={{ flexGrow: fresh || (monthCustomers.size ? 0 : 1) }} />
            <span className="is-returning" style={{ flexGrow: returning }} />
          </div>
          <div className="insight-meta"><span><i className="legend-dot" /> {fresh} νέοι</span><span><i className="legend-dot is-returning" /> {returning} παλιοί</span></div>
        </section>
        <section className="panel insight">
          <div className="panel-heading"><div><h2>Δραστηριότητα προσωπικού</h2><p>Ραντεβού αυτήτην εβδομάδα</p></div></div>
          {staffRows.length ? (
            <ul className="bar-list">
              {staffRows.map(([name, count]) => (
                <li key={name}><span>{name}</span><div className="bar-track"><div className="bar-fill" style={{ width: `${count / staffMax * 100}%` }} /></div><b>{count}</b></li>
              ))}
            </ul>
          ) : <EmptyState icon={Users} title="Χωρίς δραστηριότητα" />}
        </section>
      </div>
      <div className="insights-grid two">
        <section className="panel">
          <div className="panel-heading"><div><h2>Επερχόμενα ραντεβού</h2><p>Τα επόμενα προγραμματισμένα</p></div><Link to="/dashboard/appointments" className="text-link">Όλα <ChevronRight size={15} /></Link></div>
          {upcoming.length ? <div className="appointment-list">{upcoming.map((item) => <AppointmentRow key={item.id} appointment={item} />)}</div> : <EmptyState icon={CalendarDays} title="Δεν υπάρχουν επερχόμενα ραντεβού" />}
        </section>
        <section className="panel">
          <div className="panel-heading"><div><h2>Πρόσφατη δραστηριότητα</h2><p>Τελευταίες κρατήσεις</p></div></div>
          {recent.length ? (
            <ul className="activity-feed">
              {recent.map((item) => (
                <li key={item.id}>
                  <StatusDot tone={item.status === "cancelled" ? "off" : item.status === "confirmed" ? "ok" : "pending"} label={statusLabels[item.status] || item.status} />
                  <div><strong>{item.customer_name || "Πελάτης"}</strong><span>{item.service?.name || "Υπηρεσία"} · {statusLabels[item.status] || item.status}</span></div>
                  <time>{relativeTime(item.created_at)}</time>
                </li>
              ))}
            </ul>
          ) : <EmptyState icon={Inbox} title="Δεν υπάρχει πρόσφατη δραστηριότητα" />}
        </section>
      </div>
    </>
  );
}

function ProfessionalAI({ business, appointments, hours }) {
  const [message, setMessage] = useState("");
  const [reply, setReply] = useState("");
  const [loading, setLoading] = useState(false);
  const [replyIsError, setReplyIsError] = useState(false);
  const turns = useRef([]);
  const inFlight = useRef(false);

  useEffect(() => {
    turns.current = [];
  }, [business?.id]);

  const sendMessage = async (event) => {
    event?.preventDefault();

    const text = message.trim();
    if (!text || inFlight.current) return;

    inFlight.current = true;
    setLoading(true);
    setReply("");
    setReplyIsError(false);

    try {
      const data = await invokeWithRetry(
        "ai-assistant",
        {
          body: {
            message: text,
            business_id: business?.id,
            history: turns.current.slice(-6),
          },
        },
        { feature: "professional-ai", operation: "answer-business-question", attempts: 1, timeoutMs: 28000 },
      );
      if (typeof data?.reply !== "string" || !data.reply.trim()) throw new Error("Empty AI reply");
      turns.current = [...turns.current, { role: "user", content: text }, { role: "assistant", content: data.reply }].slice(-8);
      setReply(data.reply);
      setMessage("");
    } catch (requestError) {
      const messages = {
        ai_not_configured: "Ο AI βοηθός δεν έχει ρυθμιστεί ακόμη. Επικοινωνήστε με την υποστήριξη του BookEasy.",
        rate_limited: "Έχετε στείλει πολλά αιτήματα. Δοκιμάστε ξανά αργότερα.",
        ai_timeout: "Ο AI βοηθός άργησε να απαντήσει. Δοκιμάστε ξανά.",
        unauthenticated: "Η σύνδεσή σας έληξε. Συνδεθείτε ξανά.",
      };
      setReplyIsError(true);
      setReply(messages[requestError?.code] || "Ο AI βοηθός δεν είναι προσωρινά διαθέσιμος. Δοκιμάστε ξανά.");
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  };

  return (
    <section className="professional-ai-card">
      <div className="professional-ai-header">
        <div className="professional-ai-icon">
          <Sparkles size={20} />
        </div>
        <div>
          <span className="eyebrow">AI ΒΟΗΘΟΣ ΕΠΙΧΕΙΡΗΣΗΣ</span>
          <h2>Ρωτήστε τον AI βοηθό</h2>
          <p>
            Ο AI βοηθός γνωρίζει τα στοιχεία της επιχείρησής σας και μπορεί
            να σας βοηθήσει με τα ραντεβού και τη λειτουργία σας.
          </p>
        </div>
      </div>

      {reply && (
        <div className="professional-ai-reply" role={replyIsError ? "alert" : "status"}>
          <strong>AI Βοηθός</strong>
          <p>{reply}</p>
        </div>
      )}

      <form className="professional-ai-input" onSubmit={sendMessage}>
        <input
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="π.χ. Πόσα ραντεβού έχω σήμερα;"
          disabled={loading}
        />
        <button
          className="primary-button"
          type="submit"
          disabled={loading || !message.trim()}
        >
          {loading ? "..." : "Ρώτησε τον AI"}
        </button>
      </form>

      <div className="professional-ai-suggestions">
        <button
          type="button"
          onClick={() => setMessage("Πόσα ραντεβού έχω σήμερα;")}
        >
          Ραντεβού σήμερα
        </button>
        <button
          type="button"
          onClick={() => setMessage("Ποιο είναι το ωράριό μου;")}
        >
          Το ωράριό μου
        </button>
        <button
          type="button"
          onClick={() => setMessage("Δώσε μου μια σύντομη εικόνα της επιχείρησής μου.")}
        >
          Εικόνα επιχείρησης
        </button>
      </div>
    </section>
  );
}

function AppointmentRow({ appointment }) {
  const name = appointment.customer_name || "Πελάτης";
  return (
    <div className="appointment-row">
      <time>
        {new Date(appointment.starts_at).toLocaleTimeString("el-GR", {
          hour: "2-digit",
          minute: "2-digit",
        })}
      </time>
      <div className="timeline" />
      <div className="appointment-info">
        <div className="avatar pink">{name.slice(0, 2)}</div>
        <div>
          <strong>{name}</strong>
          <span>
            {appointment.service?.name || "Υπηρεσία"} ·{" "}
            {appointment.service?.duration_minutes || 0}′
          </span>
        </div>
      </div>
      <span className={`status ${appointment.status}`}>
        {appointment.status === "pending"
          ? "Σε αναμονή"
          : appointment.status === "completed"
            ? "Ολοκληρωμένο"
            : appointment.status === "cancelled"
              ? "Ακυρωμένο"
              : "Επιβεβαιωμένο"}
      </span>
    </div>
  );
}
function Calendar({ appointments }) {
  const [weekStart, setWeekStart] = useState(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    return start;
  });
  const weekDays = Array.from({ length: 7 }, (_, index) => {
    const day = new Date(weekStart);
    day.setDate(day.getDate() + index);
    return day;
  });
  const shiftWeek = (amount) => {
    const next = new Date(weekStart);
    next.setDate(next.getDate() + amount * 7);
    setWeekStart(next);
  };
  const resetWeek = () => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    setWeekStart(start);
  };
  const isCurrentWeek = weekDays.some(
    (day) => day.toDateString() === new Date().toDateString(),
  );
  return (
    <>
      <PageHeader
        eyebrow="ΗΜΕΡΟΛΟΓΙΟ"
        title="Το ημερολόγιό σας"
        subtitle="Δείτε και διαχειριστείτε όλα τα ραντεβού σας."
      />
      <div className="calendar-toolbar">
        <button className="icon-button" aria-label="Προηγούμενη εβδομάδα" onClick={() => shiftWeek(-1)}>
          <ChevronLeft size={18} />
        </button>
        <strong>
          {isCurrentWeek
            ? "Αυτή η εβδομάδα"
            : `${weekDays[0].toLocaleDateString("el-GR", { day: "numeric", month: "short" })} – ${weekDays[6].toLocaleDateString("el-GR", { day: "numeric", month: "short" })}`}
        </strong>
        <button className="icon-button" aria-label="Επόμενη εβδομάδα" onClick={() => shiftWeek(1)}>
          <ChevronRight size={18} />
        </button>
        <button className="outline-button today" onClick={resetWeek}>
          Σήμερα
        </button>
      </div>
      {appointments.loading ? <Loading /> : appointments.error ? <DataFailure store={appointments} /> : <section className="panel calendar-panel">
        <div className="week-grid">
          {weekDays.map((day) => (
              <div
                className={
                  day.toDateString() === new Date().toDateString()
                    ? "today-column"
                    : ""
                }
                key={day.toISOString()}
              >
                <strong>
                  {day.toLocaleDateString("el-GR", { weekday: "short" })}
                </strong>
                <span>{day.getDate()}</span>
              </div>
            ))}
        </div>
        <div className="calendar-body">
          {appointments.data
            .filter((appointment) =>
              weekDays.some(
                (day) =>
                  appointment.appointment_date ===
                  day.toISOString().slice(0, 10),
              ),
            )
            .map((appointment) => {
              const column = weekDays.findIndex(
                (day) =>
                  appointment.appointment_date ===
                  day.toISOString().slice(0, 10),
              );
              return (
                <div
                  key={appointment.id}
                  className="calendar-event"
                  style={{ gridColumn: column + 1 }}
                >
                  <b>
                    {new Date(appointment.starts_at).toLocaleTimeString("el-GR", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </b>
                  <span>{appointment.customer_name}</span>
                  <small>{appointment.service?.name || "Υπηρεσία"}</small>
                </div>
              );
            })}
        </div>
      </section>}
    </>
  );
}
function Appointments({ appointments }) {
  const [view, setView] = useState("today");
  const [rescheduling, setRescheduling] = useState(null);
  const toast = useToast();
  const confirm = useConfirm();
  const update = async (id, status) => {
    if (status === "cancelled" && !await confirm({
      title: "Ακύρωση ραντεβού",
      message: "Ο πελάτης θα ενημερωθεί για την ακύρωση. Η ενέργεια δεν αναιρείται.",
      confirmLabel: "Ακύρωση ραντεβού",
      cancelLabel: "Πίσω",
      tone: "danger",
    })) return;
    if (supabase) {
      const { error } = await supabase
        .from("appointments")
        .update({ status })
        .eq("id", id);
      if (error) toast(errorText(error), "error");
      else {
        toast("Η κατάσταση του ραντεβού ενημερώθηκε.", "success");
        appointments.reload();
      }
    }
  };
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const visibleAppointments = appointments.data.filter((item) => {
    const appointmentDate = new Date(item.starts_at);
    appointmentDate.setHours(0, 0, 0, 0);
    return view === "history" ? appointmentDate < today : appointmentDate >= today;
  });

  return (
    <>
      <PageHeader
        eyebrow="ΡΑΝΤΕΒΟΥ"
        title="Όλα τα ραντεβού"
        subtitle="Παρακολουθήστε τις κρατήσεις της επιχείρησής σας."
      />
      <div className="calendar-toolbar">
        <button className={view === "today" ? "primary-button" : "outline-button"} onClick={() => setView("today")}>Σήμερα</button>
        <button className={view === "history" ? "primary-button" : "outline-button"} onClick={() => setView("history")}>Ιστορικό</button>
      </div>
      <section className="panel table-panel">
        <table>
          <thead>
            <tr>
              <th>ΠΕΛΑΤΗΣ</th>
              <th>ΥΠΗΡΕΣΙΑ</th>
              <th>ΗΜΕΡΟΜΗΝΙΑ</th>
              <th>ΠΡΟΣΩΠΙΚΟ</th>
              <th>ΚΑΤΑΣΤΑΣΗ</th>
              <th>ΕΝΕΡΓΕΙΕΣ</th>
            </tr>
          </thead>
          <tbody>
            {appointments.loading ? (
              <tr>
                <td colSpan="6">
                  <Loading />
                </td>
              </tr>
            ) : appointments.error ? (
              <tr><td colSpan="6"><DataFailure store={appointments} /></td></tr>
            ) : visibleAppointments.length === 0 ? (
              <tr><td colSpan="6"><EmptyState icon={CalendarDays} title={view === "history" ? "Δεν υπάρχει ιστορικό ραντεβού" : "Δεν υπάρχουν ραντεβού"}>Οι νέες κρατήσεις θα εμφανίζονται εδώ μόλις γίνουν.</EmptyState></td></tr>
            ) : (
              visibleAppointments.map((item) => (
                <tr key={item.id}>
                  <td data-label="Πελάτης">
                    <div className="table-person">
                      <div className="avatar pink">
                        {(item.customer_name || "").slice(0, 2)}
                      </div>
                      <strong>{item.customer_name}</strong>
                    </div>
                  </td>
                  <td data-label="Υπηρεσία">{item.service?.name || "Υπηρεσία"}</td>
                  <td data-label="Ημερομηνία">
                    {new Date(item.starts_at).toLocaleString("el-GR", {
                      dateStyle: "short",
                      timeStyle: "short",
                    })}
                  </td>
                  <td data-label="Προσωπικό">{item.staff?.name || "—"}</td>
                  <td data-label="Κατάσταση">
                    <span className={`status ${item.status}`}>
                      {statusLabels[item.status] || item.status}
                    </span>
                  </td>
                  <td data-label="Ενέργειες" className="row-actions">
                    <button
                      className="mini-action"
                      aria-label="Επιβεβαίωση ραντεβού"
                      title="Επιβεβαίωση"
                      onClick={() => update(item.id, "confirmed")}
                    >
                      <Check size={15} />
                    </button>
                    <button
                      className="mini-action"
                      aria-label="Ολοκλήρωση ραντεβού"
                      title="Ολοκλήρωση"
                      onClick={() => update(item.id, "completed")}
                    >
                      <CheckCheck size={15} />
                    </button>
                    {!( ["cancelled", "completed"].includes(item.status)) && (
                      <button
                        className="mini-action"
                        onClick={() => setRescheduling(item)}
                        aria-label="Αλλαγή ημερομηνίας ή ώρας"
                        title="Αλλαγή ώρας"
                      >
                        Αλλαγή ώρας
                      </button>
                    )}
                    {!(["cancelled", "completed"].includes(item.status)) && (
                      <button
                        className="mini-action danger"
                        onClick={() => update(item.id, "cancelled")}
                        aria-label={item.status === "confirmed" ? "Ακύρωση ραντεβού" : "Απόρριψη ραντεβού"}
                        title={item.status === "confirmed" ? "Ακύρωση ραντεβού" : "Απόρριψη ραντεβού"}
                      >
                        {item.status === "confirmed" ? "Ακύρωση" : "Απόρριψη"}
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>
      {rescheduling && (
        <AppointmentRescheduleDialog
          appointment={rescheduling}
          onClose={() => setRescheduling(null)}
          onSaved={appointments.reload}
        />
      )}
    </>
  );
}

function Editor({ title, value, fields, onClose, onSave, saving = false }) {
  const [form, setForm] = useState(value);
  const dialogRef = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    const focusableSelector = "button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled)";
    const focusable = dialogRef.current?.querySelectorAll(focusableSelector);
    focusable?.[1]?.focus();
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const current = dialogRef.current?.querySelectorAll(focusableSelector);
      if (!current?.length) return;
      if (event.shiftKey && document.activeElement === current[0]) {
        event.preventDefault();
        current[current.length - 1].focus();
      } else if (!event.shiftKey && document.activeElement === current[current.length - 1]) {
        event.preventDefault();
        current[0].focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previous?.focus?.();
    };
  }, []);
  return (
    <div className="modal-backdrop open">
      <div ref={dialogRef} className="modal" role="dialog" aria-modal="true" aria-labelledby="editor-title">
        <div className="modal-header">
          <div>
            <span className="eyebrow">ΕΠΕΞΕΡΓΑΣΙΑ</span>
            <h2 id="editor-title">{title}</h2>
          </div>
          <button type="button" className="icon-button" aria-label="Κλείσιμο παραθύρου επεξεργασίας" onClick={onClose} disabled={saving}>
            <X size={18} />
          </button>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!saving) onSave(form);
          }}
        >
          {fields.map(([key, label]) => (
            <label key={key}>
              {label}
              {key === "description" ? (
                <textarea
                  value={form[key] || ""}
                  disabled={saving}
                  onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                />
              ) : (
                <input
                  type={
                    ["price", "duration_minutes"].includes(key)
                      ? "number"
                      : "text"
                  }
                  value={form[key] ?? ""}
                  disabled={saving}
                  onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                  required={key === "name"}
                />
              )}
            </label>
          ))}
          <label className="check-label">
            <input
              type="checkbox"
              checked={form.is_active !== false}
              disabled={saving}
              onChange={(e) =>
                setForm({ ...form, is_active: e.target.checked })
              }
            />{" "}
            Ενεργό
          </label>
          <div className="modal-footer">
            <button type="button" className="outline-button" onClick={onClose} disabled={saving}>
              Άκυρο
            </button>
            <button className="primary-button" disabled={saving}>{saving ? "Αποθήκευση..." : "Αποθήκευση"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
function AIAssistant({ business, appointments, hours }) {
  const toast = useToast();
  const openSupportEmail = () => {
    if (!BOOKEASY_SUPPORT_EMAIL) {
      toast(
        "Το BookEasy support email δεν έχει ρυθμιστεί ακόμη. Ορίστε το VITE_BOOKEASY_SUPPORT_EMAIL στο env της εφαρμογής.",
        "error",
      );
      return;
    }
    window.location.href = `mailto:${BOOKEASY_SUPPORT_EMAIL}`;
  };

  return (
    <div>
      <PageHeader
        eyebrow="BOOKEASY AI"
        title="Εξυπηρέτηση Πελατών"
        subtitle="Διαχειριστείτε τα αιτήματα πελατών και ρωτήστε τον AI βοηθό της επιχείρησής σας."
      />
      <div className="professional-support-actions">
        <button type="button" className="primary-button" onClick={openSupportEmail}>
          <Mail size={16} /> Εκπρόσωπος
        </button>
        {BOOKEASY_SUPPORT_EMAIL ? (
          <a className="support-email-link" href={`mailto:${BOOKEASY_SUPPORT_EMAIL}`}>
            {BOOKEASY_SUPPORT_EMAIL}
          </a>
        ) : (
          <small className="support-email-placeholder">
            Το BookEasy support email δεν έχει ρυθμιστεί ακόμη. Ορίστε το VITE_BOOKEASY_SUPPORT_EMAIL.
          </small>
        )}
      </div>
      <ProfessionalAI
        business={business}
        appointments={appointments}
        hours={hours}
      />
      <CustomerSupportCenter business={business} />
    </div>
  );
}

function SettingsPage({ business }) {
  const { user } = useAuth();
  return (
    <div>
      <PageHeader
        eyebrow="ΛΟΓΑΡΙΑΣΜΟΣ & ΕΙΔΟΠΟΙΗΣΕΙΣ"
        title="Ρυθμίσεις"
        subtitle="Διαχειριστείτε τον λογαριασμό και τον τρόπο ενημέρωσης της επιχείρησής σας."
      />
      <section className="panel settings-panel">
        <div>
          <span className="eyebrow">ΛΟΓΑΡΙΑΣΜΟΣ</span>
          <h2>Σύνδεση επαγγελματία</h2>
          <p>{user?.email || "Δεν είναι διαθέσιμο email λογαριασμού."}</p>
        </div>
        <div>
          <span className="eyebrow">ΑΙΤΗΜΑΤΑ ΠΕΛΑΤΩΝ</span>
          <h2>Ειδοποιήσεις</h2>
          <p>
            Τα νέα αιτήματα εμφανίζονται στο inbox εξυπηρέτησης. Η αποστολή email
            ειδοποιήσεων απαιτεί ρύθμιση παρόχου email στους server secrets του Supabase.
          </p>
          <Link className="outline-button" to="/dashboard/ai">
            <Inbox size={16} /> Άνοιγμα inbox
          </Link>
        </div>
        <div>
          <span className="eyebrow">ΕΠΙΧΕΙΡΗΣΗ</span>
          <h2>{business.name}</h2>
          <p>Το επαγγελματικό email και η δημόσια ορατότητά του ρυθμίζονται στο προφίλ επιχείρησης.</p>
          <Link className="outline-button" to="/dashboard/profile">
            Ρυθμίσεις προφίλ
          </Link>
        </div>
      </section>
    </div>
  );
}

function PlanPage({ business }) {
  return (
    <div>
      <PageHeader
        eyebrow="ΣΥΝΔΡΟΜΗ BOOKEASY"
        title="Πλάνο"
        subtitle="Δείτε το επαγγελματικό σας πακέτο και διαχειριστείτε τη συνδρομή σας."
      />
      <SubscriptionSettings business={business} />
    </div>
  );
}

function SubscriptionSettings({ business }) {
  const location = useLocation();
  const paymentReturn = new URLSearchParams(location.search).get("payment");
  const [subscription, setSubscription] = useState(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [plan, setPlan] = useState("plus");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const checkoutRequest = useRef(null);
  const [hasStoredCheckoutRequest, setHasStoredCheckoutRequest] = useState(false);
  const paidPeriodActive = Boolean(
    subscription?.status === "active" &&
    subscription.current_period_end &&
    Date.parse(subscription.current_period_end) > Date.now(),
  );
  const activeRef = useRef(paidPeriodActive);
  activeRef.current = paidPeriodActive;

  const refreshSubscription = async () => {
    if (!supabase) {
      setError(SUPABASE_CONFIG_ERROR);
      setLoading(false);
      return null;
    }
    try {
      const { data, error: requestError } = await supabase
        .from("business_subscriptions")
        .select("plan,status,current_period_start,current_period_end,cancel_at_period_end,checkout_expires_at")
        .eq("business_id", business.id)
        .maybeSingle();
      if (requestError) throw requestError;
      setSubscription(data);
      setError("");
      return data;
    } catch (requestError) {
      reportCriticalError(requestError, {
        feature: "subscriptions",
        operation: "load-subscription-state",
      });
      setError("Δεν ήταν δυνατή η φόρτωση της συνδρομής. Δοκιμάστε ξανά.");
      return null;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshSubscription();
  }, [business.id]);

  useEffect(() => {
    const refresh = window.setInterval(refreshSubscription, 30000);
    return () => window.clearInterval(refresh);
  }, [business.id]);

  useEffect(() => {
    if (subscription?.status === "checkout_pending") {
      setPlan(subscription.plan);
    }
    const requestPlan = subscription?.status === "checkout_pending"
      ? subscription.plan
      : plan;
    const key = `bookeasy-checkout-request:${business.id}:${requestPlan}`;
    try {
      setHasStoredCheckoutRequest(Boolean(sessionStorage.getItem(key)));
    } catch {
      setHasStoredCheckoutRequest(false);
    }
  }, [business.id, subscription?.status, subscription?.plan, subscription?.checkout_expires_at, plan]);

  useEffect(() => {
    if (paymentReturn !== "success" || activeRef.current) return undefined;
    let attempts = 0;
    let timer;
    const poll = async () => {
      await refreshSubscription();
      attempts += 1;
      if (attempts < 18 && !activeRef.current) {
        timer = window.setTimeout(poll, 5000);
      }
    };
    timer = window.setTimeout(poll, 1500);
    return () => window.clearTimeout(timer);
  }, [paymentReturn, business.id]);

  const dateLabel = (date) => date
    ? new Date(date).toLocaleDateString("el-GR", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : "Δεν υπάρχει διαθέσιμη ημερομηνία";

  const startCheckout = async () => {
    if (working) return;
    setWorking(true);
    setError("");
    setMessage("");
    const storageKey = `bookeasy-checkout-request:${business.id}:${plan}`;
    const checkoutExpired = subscription?.status === "incomplete_expired" ||
      (subscription?.status === "checkout_pending" &&
        subscription.checkout_expires_at &&
        Date.parse(subscription.checkout_expires_at) <= Date.now());
    if (checkoutExpired) {
      try {
        sessionStorage.removeItem(storageKey);
      } catch {
        // The request UUID is not an authorization credential.
      }
      checkoutRequest.current = null;
    }
    let requestId = null;
    try {
      requestId = sessionStorage.getItem(storageKey);
    } catch {
      // A per-page UUID still protects retries if storage is disabled.
    }
    requestId ||= checkoutRequest.current?.businessId === business.id && checkoutRequest.current?.plan === plan
      ? checkoutRequest.current.id
      : crypto.randomUUID();
    checkoutRequest.current = { businessId: business.id, plan, id: requestId };
    try {
      sessionStorage.setItem(storageKey, requestId);
    } catch {
      // Checkout remains functional without browser storage.
    }
    try {
      const result = await invokeWithRetry(
        "create-checkout",
        {
          body: {
            business_id: business.id,
            plan,
            checkout_request_id: requestId,
          },
        },
        { feature: "subscriptions", operation: "create-checkout-session", attempts: 2, timeoutMs: 20000 },
      );
      if (!result?.url) throw new Error("Checkout URL missing");
      window.location.assign(result.url);
    } catch (requestError) {
      reportCriticalError(requestError, {
        feature: "subscriptions",
        operation: "create-checkout-session",
      });
      setError("Δεν ήταν δυνατή η έναρξη της συνδρομής. Δοκιμάστε ξανά.");
      setWorking(false);
    }
  };

  const updateSubscription = async (action) => {
    if (working) return;
    setWorking(true);
    setError("");
    setMessage("");
    try {
      await invokeWithRetry(
        "manage-subscription",
        { body: { action, business_id: business.id } },
        { feature: "subscriptions", operation: action, attempts: 2, timeoutMs: 20000 },
      );
      await refreshSubscription();
      setMessage(action === "cancel"
        ? "Η ακύρωση στο τέλος της περιόδου επιβεβαιώθηκε από το Stripe."
        : "Η συνδρομή επαναφέρθηκε σύμφωνα με την ενημέρωση του Stripe.");
    } catch (requestError) {
      reportCriticalError(requestError, {
        feature: "subscriptions",
        operation: action,
      });
      setError("Δεν ήταν δυνατή η ενημέρωση της συνδρομής. Δοκιμάστε ξανά.");
    } finally {
      setWorking(false);
    }
  };

  const statusLabels = {
    active: "Ενεργή συνδρομή",
    canceled: "Ανενεργή συνδρομή",
    checkout_pending: "Ολοκλήρωση checkout σε εξέλιξη",
    incomplete: "Η πληρωμή δεν ολοκληρώθηκε",
    incomplete_expired: "Η προσπάθεια checkout έληξε",
    past_due: "Η πληρωμή απέτυχε ή εκκρεμεί",
    paused: "Η συνδρομή είναι σε παύση",
    trialing: "Δοκιμαστική συνδρομή",
    unpaid: "Η συνδρομή δεν έχει εξοφληθεί",
  };
  const pendingCheckoutActive = subscription?.status === "checkout_pending" &&
    subscription.checkout_expires_at &&
    Date.parse(subscription.checkout_expires_at) > Date.now();
  const pendingCheckoutExpired = subscription?.status === "checkout_pending" &&
    subscription.checkout_expires_at &&
    Date.parse(subscription.checkout_expires_at) <= Date.now();
  const canResumeCheckout = Boolean(pendingCheckoutActive && hasStoredCheckoutRequest);
  const canStart = !subscription ||
    (["canceled", "incomplete_expired"].includes(subscription.status) &&
      (!subscription.current_period_end || Date.parse(subscription.current_period_end) <= Date.now())) ||
    pendingCheckoutExpired ||
    canResumeCheckout;
  const canCancel = Boolean(
    subscription &&
    ["active", "past_due"].includes(subscription.status) &&
    subscription.current_period_end &&
    Date.parse(subscription.current_period_end) > Date.now() &&
    !subscription.cancel_at_period_end,
  );
  const canResume = paidPeriodActive && subscription?.cancel_at_period_end;

  return (
    <section className="panel subscription-panel" aria-labelledby="subscription-title">
      <div className="subscription-heading">
        <div className="subscription-icon"><CreditCard size={20} /></div>
        <div>
          <span className="eyebrow">ΣΥΝΔΡΟΜΗ</span>
          <h2 id="subscription-title">Επαγγελματικό πακέτο</h2>
        </div>
        <button className="icon-button" type="button" aria-label="Ανανέωση κατάστασης συνδρομής" onClick={refreshSubscription}>
          <RefreshCw size={16} />
        </button>
      </div>

      {paymentReturn === "success" && !paidPeriodActive && (
        <Notice message="Η επιστροφή από το Checkout καταγράφηκε. Περιμένουμε επιβεβαίωση Stripe· η συνδρομή δεν ενεργοποιείται από τη σελίδα επιστροφής." />
      )}
      {paymentReturn === "success" && paidPeriodActive && (
        <Notice message="Η ενεργή συνδρομή επιβεβαιώθηκε από το Stripe." success />
      )}
      {paymentReturn === "cancelled" && (
        <Notice message="Η διαδικασία Checkout ακυρώθηκε. Δεν επιβεβαιώθηκε νέα συνδρομή." />
      )}
      {message && <Notice message={message} success />}
      {error && <Notice message={error} />}

      {loading ? (
        <Loading />
      ) : subscription ? (
        <div className="subscription-state">
          <div className="subscription-summary">
            <span className="subscription-plan">{subscription.plan === "plus" ? "Plus" : "Basic"}</span>
            <strong>
              {subscription.status === "active" && !paidPeriodActive
                ? "Η περίοδος συνδρομής έληξε"
                : statusLabels[subscription.status] || "Κατάσταση συνδρομής: άγνωστη"}
            </strong>
          </div>
          {subscription.current_period_end && (
            <p>
              {subscription.cancel_at_period_end && paidPeriodActive
                ? `Η συνδρομή θα ακυρωθεί στις ${dateLabel(subscription.current_period_end)} και δεν θα γίνει νέα χρέωση.`
                : paidPeriodActive
                  ? `Η επόμενη χρέωση είναι στις ${dateLabel(subscription.current_period_end)}.`
                  : subscription.status === "past_due" && Date.parse(subscription.current_period_end) > Date.now()
                    ? `Η τρέχουσα περίοδος λήγει στις ${dateLabel(subscription.current_period_end)}. Η πληρωμή εκκρεμεί.`
                    : `Η περίοδος συνδρομής έληξε στις ${dateLabel(subscription.current_period_end)}.`}
            </p>
          )}
          {["past_due", "unpaid", "incomplete", "incomplete_expired"].includes(subscription.status) && (
            <p className="subscription-inactive-note">Η premium πρόσβαση είναι ανενεργή μέχρι να επιβεβαιωθεί ενεργή συνδρομή από το Stripe. Δεν εφαρμόζεται περίοδος χάριτος.</p>
          )}
          <div className="subscription-actions">
            {canCancel && (
              <button className="outline-button" disabled={working} onClick={() => updateSubscription("cancel")}>
                {working ? "Ενημέρωση..." : "Ακύρωση συνδρομής"}
              </button>
            )}
            {canResume && (
              <button className="primary-button" disabled={working} onClick={() => updateSubscription("resume")}>
                {working ? "Ενημέρωση..." : "Επαναφορά συνδρομής"}
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="subscription-state">
          <p>Επιλέξτε επαγγελματικό πακέτο. Η ενεργοποίηση γίνεται μόνο μετά την επιβεβαίωση από υπογεγραμμένο συμβάν Stripe.</p>
        </div>
      )}

      {canStart && !loading && (
        <div className="subscription-start">
          <label>
            Πακέτο
            <select value={plan} onChange={(event) => setPlan(event.target.value)} disabled={working || Boolean(pendingCheckoutActive)}>
              <option value="basic">Basic</option>
              <option value="plus">Plus</option>
            </select>
          </label>
          <button className="primary-button" disabled={working} onClick={startCheckout}>
            {working ? "Μετάβαση στο Checkout..." : canResumeCheckout ? "Συνέχεια στο Checkout" : "Συνέχεια στο Stripe Checkout"}
          </button>
          <small>Ασφαλές Stripe Checkout με κάρτες Visa και Mastercard, όταν είναι ενεργές και επιλέξιμες για τον λογαριασμό σας.</small>
        </div>
      )}
      <small className="subscription-footnote">Η ακύρωση ισχύει στο τέλος της πληρωμένης περιόδου. Δεν εκδίδεται αυτόματη επιστροφή χρημάτων.</small>
    </section>
  );
}

function CustomerSupportCenter({ business }) {
  const { user } = useAuth();
  const [conversations, setConversations] = useState([]);
  const conversationsRef = useRef([]);
  const [selected, setSelected] = useState(null);
  const [messages, setMessages] = useState([]);
  const [reply, setReply] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const replyRequestKey = useRef(null);

  const loadConversations = async () => {
    if (!supabase) return;
    try {
      const { data, error: requestError } = await supabase
        .from("customer_support_conversations")
        .select("id,customer_name,customer_email,customer_phone,status,channel,unread_for_business,last_message_at,created_at")
        .eq("business_id", business.id)
        .order("last_message_at", { ascending: false });
      if (requestError) throw requestError;
      const rows = data || [];
      conversationsRef.current = rows;
      setConversations(rows);
      setSelected((current) => {
        const updated = rows.find((item) => item.id === current?.id);
        return updated || current;
      });
      setError("");
    } catch (requestError) {
      reportCriticalError(requestError, {
        feature: "customer-support-inbox",
        operation: "load-conversations",
      });
      setError("Δεν ήταν δυνατή η φόρτωση των αιτημάτων. Δοκιμάστε ξανά.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadConversations();
    if (!supabase) return undefined;
    const channel = supabase
      .channel(`support-inbox-${business.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "customer_support_conversations",
          filter: `business_id=eq.${business.id}`,
        },
        loadConversations,
      )
      .subscribe();
    const refresh = window.setInterval(loadConversations, 20000);
    return () => {
      window.clearInterval(refresh);
      supabase.removeChannel(channel);
    };
  }, [business.id]);

  const loadMessages = async (conversationId) => {
    if (!supabase) return;
    setLoadingMessages(true);
    try {
      const { data, error: requestError } = await supabase
        .from("customer_support_messages")
        .select("id,sender_type,body,created_at")
        .eq("conversation_id", conversationId)
        .order("created_at");
      if (requestError) throw requestError;
      setMessages(data || []);
      const current = conversationsRef.current.find((item) => item.id === conversationId);
      if (current?.unread_for_business || current?.status === "new") {
        const nextStatus = current.status === "new" ? "in_progress" : current.status;
        const { error: updateError } = await supabase
          .from("customer_support_conversations")
          .update({
            unread_for_business: false,
            status: nextStatus,
            updated_at: new Date().toISOString(),
          })
          .eq("id", conversationId);
        if (updateError) throw updateError;
        conversationsRef.current = conversationsRef.current.map((item) =>
          item.id === conversationId
            ? { ...item, unread_for_business: false, status: nextStatus }
            : item,
        );
        setSelected((item) => item?.id === conversationId
          ? { ...item, unread_for_business: false, status: nextStatus }
          : item);
      }
      await loadConversations();
    } catch (requestError) {
      reportCriticalError(requestError, {
        feature: "customer-support-inbox",
        operation: "load-messages",
      });
      setError("Δεν ήταν δυνατή η φόρτωση της συνομιλίας.");
    } finally {
      setLoadingMessages(false);
    }
  };

  useEffect(() => {
    if (!selected?.id || !supabase) return undefined;
    loadMessages(selected.id);
    const refresh = window.setInterval(() => loadMessages(selected.id), 15000);
    return () => window.clearInterval(refresh);
  }, [selected?.id]);

  const sendReply = async (event) => {
    event.preventDefault();
    const text = reply.trim();
    if (!text || !selected || !user || sending) return;
    setSending(true);
    setError("");
    const replyRequestKeyForMessage =
      replyRequestKey.current?.conversationId === selected.id &&
        replyRequestKey.current?.text === text
        ? replyRequestKey.current.id
        : crypto.randomUUID();
    replyRequestKey.current = {
      conversationId: selected.id,
      text,
      id: replyRequestKeyForMessage,
    };
    try {
      const { error: insertError } = await supabase
        .from("customer_support_messages")
        .insert({
          conversation_id: selected.id,
          client_message_id: replyRequestKeyForMessage,
          sender_type: "professional",
          sender_user_id: user.id,
          body: text,
        });
      if (insertError && insertError.code !== "23505") throw insertError;
      const { error: updateError } = await supabase
        .from("customer_support_conversations")
        .update({
          status: selected.status === "completed" ? "in_progress" : selected.status,
          unread_for_customer: true,
          last_message_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", selected.id);
      if (updateError) throw updateError;
      replyRequestKey.current = null;
      setReply("");
      await loadMessages(selected.id);
    } catch (requestError) {
      reportCriticalError(requestError, {
        feature: "customer-support-inbox",
        operation: "send-reply",
      });
      setError("Η απάντηση δεν στάλθηκε. Ελέγξτε τη σύνδεση και δοκιμάστε ξανά.");
    } finally {
      setSending(false);
    }
  };

  const updateStatus = async (status) => {
    if (!selected || !supabase) return;
    const { error: updateError } = await supabase
      .from("customer_support_conversations")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", selected.id);
    if (updateError) {
      reportCriticalError(updateError, {
        feature: "customer-support-inbox",
        operation: "update-status",
      });
      setError("Η κατάσταση δεν αποθηκεύτηκε.");
      return;
    }
    setSelected((current) => ({ ...current, status }));
    await loadConversations();
  };

  return (
    <section className="support-center" aria-label="Αιτήματα εξυπηρέτησης πελατών">
      <div className="support-center-heading">
        <div>
          <span className="eyebrow">INBOX ΕΠΙΧΕΙΡΗΣΗΣ</span>
          <h2>Αιτήματα πελατών</h2>
        </div>
        <button className="icon-button" onClick={loadConversations} aria-label="Ανανέωση αιτημάτων">
          <RefreshCw size={17} />
        </button>
      </div>
      {error && <Notice message={error} />}
      <div className="support-center-grid">
        <div className="support-conversation-list" aria-label="Συνομιλίες">
          {loading ? (
            <Loading />
          ) : conversations.length ? conversations.map((item) => (
            <button
              type="button"
              key={item.id}
              className={`support-conversation ${selected?.id === item.id ? "selected" : ""}`}
              onClick={() => {
                setSelected(item);
                setError("");
              }}
            >
              <span className="support-conversation-icon"><MessageCircle size={17} /></span>
              <span className="support-conversation-copy">
                <strong>{item.customer_name}</strong>
                <small>{item.customer_email || item.customer_phone || "Χωρίς στοιχεία επικοινωνίας"}</small>
                <small>{new Date(item.last_message_at).toLocaleString("el-GR")}</small>
              </span>
              <span className={`support-status status-${item.status}`}>
                {item.status === "new" ? "Νέο" : item.status === "in_progress" ? "Σε εξέλιξη" : "Ολοκληρώθηκε"}
              </span>
              {item.unread_for_business && <span className="support-unread" aria-label="Μη αναγνωσμένο" />}
            </button>
          )) : (
            <div className="empty-state">Δεν υπάρχουν αιτήματα πελατών ακόμη.</div>
          )}
        </div>

        <section className="support-conversation-detail" aria-label="Λεπτομέρειες αιτήματος">
          {!selected ? (
            <div className="empty-state support-select-prompt">
              <Inbox size={26} />
              <span>Επιλέξτε ένα αίτημα για να δείτε τη συνομιλία.</span>
            </div>
          ) : (
            <>
              <header className="support-detail-header">
                <div>
                  <h3>{selected.customer_name}</h3>
                  <p>{[selected.customer_email, selected.customer_phone].filter(Boolean).join(" · ")}</p>
                </div>
                <select
                  aria-label="Κατάσταση αιτήματος"
                  value={selected.status}
                  onChange={(event) => updateStatus(event.target.value)}
                >
                  <option value="new">Νέο</option>
                  <option value="in_progress">Σε εξέλιξη</option>
                  <option value="completed">Ολοκληρώθηκε</option>
                </select>
              </header>
              <div className="support-message-list">
                {loadingMessages ? <Loading /> : messages.map((item) => (
                  <article
                    className={`support-message support-message-${item.sender_type}`}
                    key={item.id}
                  >
                    <div className="support-message-meta">
                      <strong>{item.sender_type === "customer" ? "Πελάτης" : item.sender_type === "assistant" ? "AI BookEasy" : "Εσείς"}</strong>
                      <time>{new Date(item.created_at).toLocaleString("el-GR")}</time>
                    </div>
                    <p>{item.body}</p>
                  </article>
                ))}
              </div>
              <form className="support-reply-form" onSubmit={sendReply}>
                <textarea
                  value={reply}
                  onChange={(event) => setReply(event.target.value.slice(0, 4000))}
                  maxLength={4000}
                  rows={3}
                  placeholder="Γράψτε την απάντησή σας..."
                  disabled={sending || selected.status === "completed"}
                  required
                />
                <button className="primary-button" disabled={sending || !reply.trim() || selected.status === "completed"}>
                  <Send size={16} /> {sending ? "Αποστολή..." : "Απάντηση"}
                </button>
              </form>
            </>
          )}
        </section>
      </div>
    </section>
  );
}

function Services({ business }) {
  const store = useData("services", business.id, { order: "name" });
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const confirm = useConfirm();
  const save = async (form) => {
    if (saving) return;
    if (!String(form.name || "").trim() || !Number.isInteger(Number(form.duration_minutes)) || Number(form.duration_minutes) < 1 || !Number.isFinite(Number(form.price)) || Number(form.price) < 0) {
      toast("Ελέγξτε το όνομα, τη διάρκεια και την τιμή της υπηρεσίας.", "error");
      return;
    }
    setSaving(true);
    const payload = {
      business_id: business.id,
      name: form.name.trim(),
      description: form.description,
      duration_minutes: Number(form.duration_minutes),
      price: Number(form.price),
      is_active: form.is_active,
    };
    try {
      const request = form.id
        ? supabase.from("services").update(payload).eq("id", form.id)
        : supabase.from("services").insert(payload);
      const { error } = await request;
      if (error) throw error;
      toast("Η υπηρεσία αποθηκεύτηκε.", "success");
      setEditing(null);
      store.reload();
    } catch (error) {
      reportCriticalError(error, { feature: "services", operation: "save-service" });
      toast(errorText(error), "error");
    } finally {
      setSaving(false);
    }
  };
  const remove = async (id) => {
    if (!await confirm({
      title: "Απενεργοποίηση υπηρεσίας",
      message: "Η υπηρεσία δεν θα εμφανίζεται σε νέες κρατήσεις. Τα υπάρχοντα ραντεβού και το ιστορικό της θα διατηρηθούν.",
      confirmLabel: "Απενεργοποίηση",
      cancelLabel: "Πίσω",
      tone: "danger",
    })) return;
    const { error } = await supabase.from("services").update({ is_active: false }).eq("id", id);
    if (error) toast(errorText(error), "error");
    else {
      toast("Η υπηρεσία απενεργοποιήθηκε. Το ιστορικό της διατηρείται.", "success");
      store.reload();
    }
  };
  return (
    <>
      <PageHeader
        eyebrow="ΥΠΗΡΕΣΙΕΣ"
        title="Οι υπηρεσίες σας"
        subtitle="Τιμοκατάλογος και διάρκεια ραντεβού."
        action={
          <button
            className="primary-button"
            onClick={() =>
              setEditing({
                name: "",
                description: "",
                duration_minutes: 30,
                price: 0,
                is_active: true,
              })
            }
          >
            <Plus size={17} /> Νέα υπηρεσία
          </button>
        }
      />
      {store.loading ? (
        <Loading />
      ) : store.error ? (
        <DataFailure store={store} />
      ) : (
        <div className="service-grid">
          {store.data.map((service) => (
            <div className="service-card" key={service.id}>
              <div className="service-swatch blue">
                <Scissors size={20} />
              </div>
              <div>
                <strong>{service.name}</strong>
                <span>
                  <Clock3 size={14} /> {service.duration_minutes} λεπτά ·{" "}
                  {service.is_active ? "Ενεργή" : "Ανενεργή"}
                </span>
              </div>
              <b>{service.price}€</b>
              <button
                className="mini-action"
                onClick={() => setEditing(service)}
              >
                Επεξεργασία
              </button>
              <button
                className="mini-action danger"
                aria-label={`Απενεργοποίηση υπηρεσίας ${service.name}`}
                onClick={() => remove(service.id)}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
      {editing && (
        <Editor
          title="Υπηρεσία"
          value={editing}
          fields={[
            ["name", "Όνομα"],
            ["description", "Περιγραφή"],
            ["price", "Τιμή"],
            ["duration_minutes", "Διάρκεια (λεπτά)"],
          ]}
          onClose={() => setEditing(null)}
          onSave={save}
          saving={saving}
        />
      )}
    </>
  );
}
function Staff({ business }) {
  const store = useData("staff", business.id, { order: "name" });
  const [editing, setEditing] = useState(null);
  const [hoursFor, setHoursFor] = useState(null);
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const confirm = useConfirm();
  const save = async (form) => {
    if (saving) return;
    if (!String(form.name || "").trim()) {
      toast("Συμπληρώστε το όνομα του μέλους της ομάδας.", "error");
      return;
    }
    setSaving(true);
    const payload = {
      business_id: business.id,
      name: form.name.trim(),
      description: form.description,
      is_active: form.is_active,
    };
    try {
      const request = form.id
        ? supabase.from("staff").update(payload).eq("id", form.id)
        : supabase.from("staff").insert(payload);
      const { error } = await request;
      if (error) throw error;
      toast("Το μέλος της ομάδας αποθηκεύτηκε.", "success");
      setEditing(null);
      store.reload();
    } catch (error) {
      reportCriticalError(error, { feature: "staff", operation: "save-staff-member" });
      toast(errorText(error), "error");
    } finally {
      setSaving(false);
    }
  };
  const remove = async (id) => {
    if (!await confirm({
      title: "Απενεργοποίηση μέλους ομάδας",
      message: "Το μέλος δεν θα εμφανίζεται σε νέες κρατήσεις. Τα υπάρχοντα ραντεβού και το ιστορικό θα διατηρηθούν.",
      confirmLabel: "Απενεργοποίηση",
      cancelLabel: "Πίσω",
      tone: "danger",
    })) return;
    const { error } = await supabase.from("staff").update({ is_active: false }).eq("id", id);
    if (error) toast(errorText(error), "error");
    else {
      toast("Το μέλος της ομάδας απενεργοποιήθηκε. Το ιστορικό διατηρείται.", "success");
      store.reload();
    }
  };
  return (
    <>
      <PageHeader
        eyebrow="ΟΜΑΔΑ"
        title="Η ομάδα σας"
        subtitle="Διαχειριστείτε το προσωπικό και τις διαθεσιμότητές του."
        action={
          <button
            className="primary-button"
            onClick={() =>
              setEditing({ name: "", description: "", is_active: true })
            }
          >
            <Plus size={17} /> Προσθήκη μέλους
          </button>
        }
      />
      {store.loading ? (
        <Loading />
      ) : store.error ? (
        <DataFailure store={store} />
      ) : (
        <div className="staff-grid">
          {store.data.map((person) => (
            <div className="staff-card" key={person.id}>
              <div className="avatar large blue">{person.name.slice(0, 2)}</div>
              <strong>{person.name}</strong>
              <span>
                {person.description || "Μέλος ομάδας"} ·{" "}
                {person.is_active ? "Ενεργό" : "Ανενεργό"}
              </span>
              <div className="staff-meta">
                <span>Κατάσταση</span>
                <b>{person.is_active ? "Ενεργό" : "Ανενεργό"}</b>
              </div>
              <button
                className="outline-button"
                onClick={() => setEditing(person)}
              >
                Επεξεργασία
              </button>
              <button
                className="outline-button"
                onClick={() => setHoursFor(person)}
              >
                Ωράριο
              </button>
              <button
                className="mini-action danger"
                aria-label={`Απενεργοποίηση μέλους ομάδας ${person.name}`}
                onClick={() => remove(person.id)}
              >
                <Trash2 size={14} /> Διαγραφή
              </button>
            </div>
          ))}
        </div>
      )}
      {editing && (
        <Editor
          title="Μέλος ομάδας"
          value={editing}
          fields={[
            ["name", "Όνομα"],
            ["description", "Περιγραφή / ρόλος"],
          ]}
          onClose={() => setEditing(null)}
          onSave={save}
          saving={saving}
        />
      )}
      {hoursFor && (
        <StaffHoursEditor
          business={business}
          staffMember={hoursFor}
          onClose={() => setHoursFor(null)}
        />
      )}
    </>
  );
}

function ScheduleRulesEditor({ breaks, setBreaks, exceptions, setExceptions, saving }) {
  const addBreak = (day_of_week) => setBreaks((current) => [
    ...current,
    { key: crypto.randomUUID(), day_of_week, start_time: "12:00", end_time: "13:00" },
  ]);
  const addException = () => setExceptions((current) => [
    ...current,
    { key: crypto.randomUUID(), exception_date: "", is_closed: true, start_time: "", end_time: "" },
  ]);

  return (
    <div className="schedule-rules-editor">
      <section aria-labelledby="breaks-title">
        <h3 id="breaks-title">Εβδομαδιαία διαλείμματα</h3>
        {dayNames.map((day, day_of_week) => (
          <fieldset className="schedule-rule-row" key={day_of_week}>
            <legend>{day}</legend>
            {breaks.filter((item) => Number(item.day_of_week) === day_of_week).map((item) => (
              <div className="schedule-rule-fields" key={item.key}>
                <label>Από<input type="time" value={item.start_time?.slice(0, 5) || ""} disabled={saving} onChange={(event) => setBreaks((current) => current.map((entry) => entry.key === item.key ? { ...entry, start_time: event.target.value } : entry))} /></label>
                <label>Έως<input type="time" value={item.end_time?.slice(0, 5) || ""} disabled={saving} onChange={(event) => setBreaks((current) => current.map((entry) => entry.key === item.key ? { ...entry, end_time: event.target.value } : entry))} /></label>
                <button type="button" className="mini-action danger" aria-label={`Αφαίρεση διαλείμματος ${day}`} disabled={saving} onClick={() => setBreaks((current) => current.filter((entry) => entry.key !== item.key))}><Trash2 size={14} /></button>
              </div>
            ))}
            <button type="button" className="outline-button schedule-add-rule" disabled={saving} onClick={() => addBreak(day_of_week)}>Προσθήκη διαλείμματος</button>
          </fieldset>
        ))}
      </section>
      <section aria-labelledby="exceptions-title">
        <div className="schedule-rules-heading"><h3 id="exceptions-title">Αργίες και εξαιρέσεις</h3><button type="button" className="outline-button" disabled={saving} onClick={addException}>Προσθήκη ημερομηνίας</button></div>
        {exceptions.map((item) => (
          <div className="schedule-exception-row" key={item.key}>
            <label>Ημερομηνία<input type="date" value={item.exception_date || ""} disabled={saving} onChange={(event) => setExceptions((current) => current.map((entry) => entry.key === item.key ? { ...entry, exception_date: event.target.value } : entry))} /></label>
            <label className="check-label"><input type="checkbox" checked={Boolean(item.is_closed)} disabled={saving} onChange={(event) => setExceptions((current) => current.map((entry) => entry.key === item.key ? { ...entry, is_closed: event.target.checked } : entry))} />Κλειστά</label>
            {!item.is_closed && <div className="schedule-rule-fields">
              <label>Από<input type="time" value={item.start_time || ""} disabled={saving} onChange={(event) => setExceptions((current) => current.map((entry) => entry.key === item.key ? { ...entry, start_time: event.target.value } : entry))} /></label>
              <label>Έως<input type="time" value={item.end_time || ""} disabled={saving} onChange={(event) => setExceptions((current) => current.map((entry) => entry.key === item.key ? { ...entry, end_time: event.target.value } : entry))} /></label>
            </div>}
            <button type="button" className="mini-action danger" aria-label="Αφαίρεση εξαίρεσης" disabled={saving} onClick={() => setExceptions((current) => current.filter((entry) => entry.key !== item.key))}><Trash2 size={14} /></button>
          </div>
        ))}
      </section>
    </div>
  );
}

function StaffHoursEditor({ business, staffMember, onClose }) {
  const [hours, setHours] = useState([]);
  const [breaks, setBreaks] = useState([]);
  const [exceptions, setExceptions] = useState([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const [hoursResult, breaksResult, exceptionsResult] = await Promise.all([
          supabase.from("working_hours").select("*").eq("business_id", business.id).eq("staff_id", staffMember.id).order("day_of_week"),
          supabase.from("working_hour_breaks").select("*").eq("business_id", business.id).eq("staff_id", staffMember.id).order("day_of_week"),
          supabase.from("availability_exceptions").select("*").eq("business_id", business.id).eq("staff_id", staffMember.id).order("exception_date"),
        ]);
        const loadError = hoursResult.error || breaksResult.error || exceptionsResult.error;
        if (loadError) throw loadError;
        if (!active) return;
        setHours(
          (hoursResult.data?.length
            ? hoursResult.data
            : dayNames.map((name, day_of_week) => ({
                name,
                day_of_week,
                start_time: "09:00:00",
                end_time: "18:00:00",
                is_closed: day_of_week === 0,
              })))
            .map((item) => ({ ...item, name: dayNames[item.day_of_week] })),
        );
          setBreaks((breaksResult.data || []).map((item) => ({ ...item, key: item.id })));
          setExceptions((exceptionsResult.data || []).map((item) => ({ ...item, key: item.id })));
      } catch (error) {
        if (active) {
          setLoadFailed(true);
          setMessage(errorText(error));
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => { active = false; };
  }, [business.id, staffMember.id]);
  const save = async (event) => {
    event.preventDefault();
    if (saving || loading || loadFailed) return;
    if (hours.some((hour) => !hour.is_closed && hour.start_time >= hour.end_time)) {
      setMessage("Για κάθε ημέρα λειτουργίας, η ώρα έναρξης πρέπει να προηγείται της ώρας λήξης.");
      return;
    }
    const invalidBreak = breaks.some((item) => {
      const dayHours = hours.find((hour) => Number(hour.day_of_week) === Number(item.day_of_week));
      return !item.start_time || !item.end_time || item.start_time >= item.end_time ||
        !dayHours || dayHours.is_closed || item.start_time < dayHours.start_time || item.end_time > dayHours.end_time;
    });
    if (invalidBreak) {
      setMessage("Ελέγξτε τα διαλείμματα. Κάθε διάλειμμα πρέπει να βρίσκεται μέσα στο ωράριο λειτουργίας.");
      return;
    }
    const exceptionDates = exceptions.map((item) => item.exception_date);
    if (exceptions.some((item) => !item.exception_date || (!item.is_closed && (!item.start_time || !item.end_time || item.start_time >= item.end_time))) || new Set(exceptionDates).size !== exceptionDates.length) {
      setMessage("Ελέγξτε τις αργίες και τις εξαιρέσεις. Κάθε ημερομηνία πρέπει να είναι μοναδική και το ειδικό ωράριο έγκυρο.");
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      const { error } = await supabase.rpc("replace_availability_schedule", {
        p_business: business.id,
        p_staff: staffMember.id,
        p_hours: hours.map(({ day_of_week, start_time, end_time, is_closed }) => ({
          day_of_week,
          start_time,
          end_time,
          is_closed: Boolean(is_closed),
        })),
        p_breaks: breaks.map(({ day_of_week, start_time, end_time }) => ({ day_of_week, start_time, end_time })),
        p_exceptions: exceptions.map(({ exception_date, is_closed, start_time, end_time }) => ({
          exception_date,
          is_closed: Boolean(is_closed),
          start_time: is_closed ? null : start_time,
          end_time: is_closed ? null : end_time,
        })),
      });
      if (error) throw error;
      onClose();
    } catch (error) {
      reportCriticalError(error, { feature: "working-hours", operation: "save-staff-hours" });
      setMessage(errorText(error));
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="modal-backdrop open">
      <div className="modal">
        <div className="modal-header">
          <div>
            <span className="eyebrow">ΩΡΑΡΙΟ ΠΡΟΣΩΠΙΚΟΥ</span>
            <h2>{staffMember.name}</h2>
          </div>
          <button className="icon-button" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <form onSubmit={save}>
          {message && <Notice message={message} />}
          {loading ? <Loading /> : <>
            <div className="hours-editor">
              {hours.map((hour) => (
              <div key={hour.day_of_week}>
                <strong>{hour.name}</strong>
                <input
                  type="time"
                  disabled={hour.is_closed || saving}
                  value={hour.start_time?.slice(0, 5) || "09:00"}
                  onChange={(event) =>
                    setHours(
                      hours.map((item) =>
                        item.day_of_week === hour.day_of_week
                          ? { ...item, start_time: event.target.value }
                          : item,
                      ),
                    )
                  }
                />
                <span>–</span>
                <input
                  type="time"
                  disabled={hour.is_closed || saving}
                  value={hour.end_time?.slice(0, 5) || "18:00"}
                  onChange={(event) =>
                    setHours(
                      hours.map((item) =>
                        item.day_of_week === hour.day_of_week
                          ? { ...item, end_time: event.target.value }
                          : item,
                      ),
                    )
                  }
                />
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={hour.is_closed}
                    disabled={saving}
                    onChange={(event) =>
                      setHours(
                        hours.map((item) =>
                          item.day_of_week === hour.day_of_week
                            ? { ...item, is_closed: event.target.checked }
                            : item,
                        ),
                      )
                    }
                  />
                  Κλειστά
                </label>
              </div>
              ))}
            </div>
            <ScheduleRulesEditor breaks={breaks} setBreaks={setBreaks} exceptions={exceptions} setExceptions={setExceptions} saving={saving} />
          </>}
          <div className="modal-footer">
            <button type="button" className="outline-button" onClick={onClose} disabled={saving}>
              Άκυρο
            </button>
            <button className="primary-button" disabled={loading || saving || loadFailed}>
              {saving ? "Αποθήκευση..." : loadFailed ? "Δεν είναι δυνατή η αποθήκευση" : "Αποθήκευση"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Profile({ business, setBusiness }) {
  const { user } = useAuth();
  const [form, setForm] = useState(business);
  const [contactSettings, setContactSettings] = useState({
    professional_email: user?.email || "",
    email_is_public: false,
    time_zone: "Europe/Athens",
  });
  const [message, setMessage] = useState("");
  const [hours, setHours] = useState([]);
  const [breaks, setBreaks] = useState([]);
  const [exceptions, setExceptions] = useState([]);
  const [photos, setPhotos] = useState("");
  const [uploading, setUploading] = useState("");
  const [saving, setSaving] = useState(false);
  const defaultHours = dayNames.map((name, day_of_week) => ({
    name,
    day_of_week,
    start_time: "09:00:00",
    end_time: "18:00:00",
    is_closed: day_of_week === 0,
    staff_id: null,
  }));
  useEffect(() => {
    Promise.all([
      supabase.from("working_hours").select("*").eq("business_id", business.id),
      supabase.from("working_hour_breaks").select("*").eq("business_id", business.id).is("staff_id", null),
      supabase.from("availability_exceptions").select("*").eq("business_id", business.id).is("staff_id", null).order("exception_date"),
      supabase
        .from("business_media")
        .select("url")
        .eq("business_id", business.id)
        .order("sort_order"),
      supabase
        .from("business_contact_settings")
        .select("professional_email,email_is_public,time_zone")
        .eq("business_id", business.id)
        .maybeSingle(),
    ]).then(([hourResult, breakResult, exceptionResult, mediaResult, contactResult]) => {
      if (hourResult.error) setMessage(errorText(hourResult.error));
      if (breakResult.error) setMessage(errorText(breakResult.error));
      if (exceptionResult.error) setMessage(errorText(exceptionResult.error));
      const businessHours = (hourResult.data || []).filter((item) => !item.staff_id);
      setHours(
        (businessHours.length ? businessHours : defaultHours).map((item) => ({
          ...item,
          name: dayNames[item.day_of_week],
        })),
      );
      setBreaks((breakResult.data || []).map((item) => ({ ...item, key: item.id })));
      setExceptions((exceptionResult.data || []).map((item) => ({ ...item, key: item.id })));
      if (mediaResult.error) setMessage(errorText(mediaResult.error));
      setPhotos((mediaResult.data || []).map((item) => item.url).join(", "));
      if (contactResult.error) setMessage("Δεν ήταν δυνατή η φόρτωση των στοιχείων επικοινωνίας.");
      setContactSettings({
        professional_email: contactResult.data?.professional_email || user?.email || "",
        email_is_public: contactResult.data?.email_is_public || false,
        time_zone: contactResult.data?.time_zone || "Europe/Athens",
      });
    }).catch((requestError) => {
      reportCriticalError(requestError, {
        feature: "business-profile",
        operation: "load-profile-settings",
      });
      setHours(defaultHours);
      setMessage("Δεν ήταν δυνατή η φόρτωση όλων των στοιχείων. Δοκιμάστε ξανά.");
    });
  }, [business.id, user?.email]);
  const uploadMedia = async (file, folder) => {
    if (!file) return null;
    const extension = file.name.includes(".")
      ? file.name.split(".").pop().toLowerCase()
      : "jpg";
    const safeName = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${extension}`;
    const path = `${business.id}/${folder}/${safeName}`;

    if (!file.type.startsWith("image/") || file.size > 8 * 1024 * 1024) {
      setMessage("Επιλέξτε εικόνα μικρότερη από 8 MB.");
      return null;
    }
    try {
      const { error } = await supabase.storage
        .from("business-media")
        .upload(path, file, {
          cacheControl: "3600",
          upsert: false,
          contentType: file.type || undefined,
        });
      if (error) throw error;
      const { data } = supabase.storage
        .from("business-media")
        .getPublicUrl(path);
      return data.publicUrl;
    } catch (requestError) {
      reportCriticalError(requestError, {
        feature: "business-profile-media",
        operation: "upload-image",
      });
      setMessage("Η εικόνα δεν ανέβηκε. Ελέγξτε τη σύνδεσή σας και δοκιμάστε ξανά.");
      return null;
    }
  };

  const handleLogoUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploading("logo");
    const url = await uploadMedia(file, "logo");

    if (url) {
      setForm((current) => ({ ...current, logo_url: url }));
      setMessage("Το logo ανέβηκε. Πάτησε «Αποθήκευση αλλαγών».");
    }

    setUploading("");
    event.target.value = "";
  };

  const handleCoverUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploading("cover");
    const url = await uploadMedia(file, "cover");

    if (url) {
      setForm((current) => ({ ...current, cover_image_url: url }));
      setMessage("Το cover ανέβηκε. Πάτησε «Αποθήκευση αλλαγών».");
    }

    setUploading("");
    event.target.value = "";
  };

  const handleGalleryUpload = async (event) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;

    setUploading("gallery");
    const uploadedUrls = [];

    for (const file of files) {
      const url = await uploadMedia(file, "gallery");
      if (url) uploadedUrls.push(url);
    }

    if (uploadedUrls.length) {
      const existing = photos
        .split(",")
        .map((url) => url.trim())
        .filter(Boolean);

      setPhotos([...existing, ...uploadedUrls].join(", "));
      setMessage(
        `${uploadedUrls.length} φωτογραφία/φωτογραφίες ανέβηκαν. Πάτησε «Αποθήκευση αλλαγών».`,
      );
    }

    setUploading("");
    event.target.value = "";
  };

  
const performSave = async () => {
    const professionalEmail = contactSettings.professional_email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(professionalEmail)) {
      setMessage("Συμπληρώστε ένα έγκυρο επαγγελματικό email.");
      return;
    }
    try {
      new Intl.DateTimeFormat("el-GR", { timeZone: contactSettings.time_zone });
    } catch {
      setMessage("Συμπληρώστε έγκυρη ζώνη ώρας, όπως Europe/Athens.");
      return;
    }
    const urls = photos
      .split(",")
      .map((url) => url.trim())
      .filter(Boolean);
    const invalidBreak = breaks.some((item) => {
      const dayHours = hours.find((hour) => Number(hour.day_of_week) === Number(item.day_of_week));
      return !item.start_time || !item.end_time || item.start_time >= item.end_time ||
        !dayHours || dayHours.is_closed || item.start_time < dayHours.start_time || item.end_time > dayHours.end_time;
    });
    if (invalidBreak) {
      setMessage("Ελέγξτε τα διαλείμματα. Κάθε διάλειμμα πρέπει να βρίσκεται μέσα στο ωράριο λειτουργίας.");
      return;
    }
    if (breaks.some((item) => !item.start_time || !item.end_time || item.start_time >= item.end_time)) {
      setMessage("Ελέγξτε ότι κάθε διάλειμμα έχει έγκυρη ώρα έναρξης και λήξης.");
      return;
    }
    if (exceptions.some((item) => !item.exception_date || (!item.is_closed && (!item.start_time || !item.end_time || item.start_time >= item.end_time))) || new Set(exceptions.map((item) => item.exception_date)).size !== exceptions.length) {
      setMessage("Ελέγξτε τις αργίες και τις εξαιρέσεις. Οι ημερομηνίες πρέπει να είναι μοναδικές και τα ωράρια έγκυρα.");
      return;
    }
    // Profile and complete availability changes are committed in one database transaction.
    const { error } = await supabase.rpc("save_business_profile_with_schedule", {
      p_business: business.id,
      p_profile: {
        name: form.name,
        slug: form.slug,
        description: form.description,
        address: form.address,
        phone: form.phone,
        city: form.city,
        category: form.category,
        logo_url: form.logo_url,
        cover_image_url: form.cover_image_url,
        primary_color: form.primary_color,
      },
      p_contact: {
        professional_email: professionalEmail,
        email_is_public: contactSettings.email_is_public,
        time_zone: contactSettings.time_zone,
      },
      p_hours: hours.map(({ day_of_week, start_time, end_time, is_closed }) => ({
        day_of_week,
        start_time,
        end_time,
        is_closed: Boolean(is_closed),
      })),
      p_breaks: breaks.map(({ day_of_week, start_time, end_time }) => ({ day_of_week, start_time, end_time })),
      p_exceptions: exceptions.map(({ exception_date, is_closed, start_time, end_time }) => ({
        exception_date,
        is_closed: Boolean(is_closed),
        start_time: is_closed ? null : start_time,
        end_time: is_closed ? null : end_time,
      })),
      p_urls: urls,
    });
    if (error) {
      reportCriticalError(error, {
        feature: "business-profile",
        operation: "save-business-profile",
      });
      setMessage(errorText(error));
      return;
    }
    setBusiness(form);
    setMessage("Οι αλλαγές αποθηκεύτηκαν.");
    setTimeout(() => setMessage(""), 3000);
  };
  const save = async (event) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      await performSave();
    } catch (requestError) {
      reportCriticalError(requestError, {
        feature: "business-profile",
        operation: "save-profile-settings",
      });
      setMessage(errorText(requestError));
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <PageHeader
        eyebrow="ΠΡΟΦΙΛ ΕΠΙΧΕΙΡΗΣΗΣ"
        title="Η επιχείρησή σας"
        subtitle="Τα στοιχεία της επιχείρησης εμφανίζονται δημόσια. Το επαγγελματικό email παραμένει ιδιωτικό εκτός αν επιλέξετε να το δημοσιοποιήσετε."
      />
      <section className="panel form-panel">
        <Notice message={message} success={message.includes("αποθηκεύτηκαν")} />
        <form onSubmit={save}>
          <div className="form-heading">
            <div className="business-logo">{business.name[0]}</div>
            <div>
              <h2>Βασικές πληροφορίες</h2>
              <p>Ενημερώστε την εικόνα της επιχείρησής σας.</p>
            </div>
          </div>
          <div className="form-grid">
            <label>
              Όνομα επιχείρησης
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
            </label>
            <label>
              Όνομα συνδέσμου
              <input
                value={form.slug}
                onChange={(e) =>
                  setForm({
                    ...form,
                    slug: e.target.value
                      .toLowerCase()
                      .replace(/[^a-z0-9-]/g, "-"),
                  })
                }
                required
              />
              <small className="slug-preview">
                {window.location.origin}/b/{form.slug}
              </small>
            </label>
            <label className="wide">
              Περιγραφή
              <textarea
                value={form.description || ""}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
              />
            </label>
            <label>
              Τηλέφωνο
              <input
                value={form.phone || ""}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </label>
            <label>
              Επαγγελματικό email
              <input
                type="email"
                autoComplete="email"
                value={contactSettings.professional_email}
                onChange={(e) =>
                  setContactSettings({ ...contactSettings, professional_email: e.target.value })
                }
                required
              />
            </label>
            <label>
              Ζώνη ώρας επιχείρησης
              <input
                value={contactSettings.time_zone}
                onChange={(e) =>
                  setContactSettings({ ...contactSettings, time_zone: e.target.value })
                }
                placeholder="Europe/Athens"
                required
              />
            </label>
            <label className="check-label wide">
              <input
                type="checkbox"
                checked={contactSettings.email_is_public}
                onChange={(e) =>
                  setContactSettings({ ...contactSettings, email_is_public: e.target.checked })
                }
              />
              Εμφάνιση του email στη δημόσια εξυπηρέτηση πελατών
            </label>
            <label>
              Διεύθυνση
              <input
                value={form.address || ""}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
              />
            </label>
            <label>
              Logo
              <input
                type="file"
                accept="image/*"
                onChange={handleLogoUpload}
                disabled={uploading === "logo"}
              />
              {uploading === "logo" && <small>Ανέβασμα logo...</small>}
              {form.logo_url && (
                <img
                  className="profile-media-preview"
                  src={form.logo_url}
                  alt="Logo preview"
                />
              )}
            </label>
            <label>
              Cover / banner
              <input
                type="file"
                accept="image/*"
                onChange={handleCoverUpload}
                disabled={uploading === "cover"}
              />
              {uploading === "cover" && <small>Ανέβασμα cover...</small>}
              {form.cover_image_url && (
                <img
                  className="profile-cover-preview"
                  src={form.cover_image_url}
                  alt="Cover preview"
                />
              )}
            </label>
            <label>
              Primary color
              <input
                type="color"
                value={form.primary_color || "#A78BFA"}
                onChange={(e) =>
                  setForm({ ...form, primary_color: e.target.value })
                }
              />
            </label>
            <label className="wide">
              Φωτογραφίες gallery
              <input
                type="file"
                accept="image/*"
                multiple
                onChange={handleGalleryUpload}
                disabled={uploading === "gallery"}
              />
              {uploading === "gallery" && (
                <small>Ανέβασμα φωτογραφιών...</small>
              )}
              <input
                value={photos}
                onChange={(e) => setPhotos(e.target.value)}
                placeholder="ή βάλε URLs: url1, url2, url3"
              />
            </label>
          </div>
          <h2 className="section-title">Ωράριο λειτουργίας</h2>
          <div className="hours-editor">
            {hours.map((hour) => (
              <div key={hour.day_of_week}>
                <strong>{hour.name}</strong>
                <input
                  type="time"
                  disabled={hour.is_closed}
                  value={hour.start_time}
                  onChange={(e) =>
                    setHours(
                      hours.map((item) =>
                        item.day_of_week === hour.day_of_week
                          ? { ...item, start_time: e.target.value }
                          : item,
                      ),
                    )
                  }
                />
                <span>–</span>
                <input
                  type="time"
                  disabled={hour.is_closed}
                  value={hour.end_time}
                  onChange={(e) =>
                    setHours(
                      hours.map((item) =>
                        item.day_of_week === hour.day_of_week
                          ? { ...item, end_time: e.target.value }
                          : item,
                      ),
                    )
                  }
                />
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={hour.is_closed}
                    onChange={(e) =>
                      setHours(
                        hours.map((item) =>
                          item.day_of_week === hour.day_of_week
                            ? { ...item, is_closed: e.target.checked }
                            : item,
                        ),
                      )
                    }
                  />{" "}
                  Κλειστά
                </label>
              </div>
            ))}
          </div>
          <ScheduleRulesEditor breaks={breaks} setBreaks={setBreaks} exceptions={exceptions} setExceptions={setExceptions} saving={saving || Boolean(uploading)} />
          <div className="form-actions">
            <button className="primary-button" disabled={saving || Boolean(uploading)}>
              {saving ? "Αποθήκευση..." : "Αποθήκευση αλλαγών"}
            </button>
          </div>
        </form>
      </section>
    </>
  );
}
function WorkingHours({ business, setBusiness }) {
  return <Profile business={business} setBusiness={setBusiness} />;
}
function Customers({ business }) {
  const appointments = useData("appointments", business.id, {
    select: "*, service:services(name), staff:staff(name)",
  });
  const customers = [
    ...new Map(
      appointments.data.map((item) => [
        item.customer_email || item.customer_name,
        item,
      ]),
    ).values(),
  ];
  return (
    <>
      <PageHeader
        eyebrow="ΠΕΛΑΤΕΣ"
        title="Η πελατεία σας"
        subtitle="Οι πελάτες προκύπτουν από τα ραντεβού σας."
      />
      {appointments.loading ? (
        <Loading />
      ) : appointments.error ? (
        <DataFailure store={appointments} />
      ) : (
        <div className="customer-grid">
          {customers.map((item) => (
            <div
              className="customer-card"
              key={item.customer_email || item.customer_name}
            >
              <div className="avatar pink">
                {item.customer_name?.slice(0, 2)}
              </div>
              <div>
                <strong>{item.customer_name}</strong>
                <span>{item.customer_email || "Χωρίς email"}</span>
                <small>
                  {
                    appointments.data.filter(
                      (x) => x.customer_email === item.customer_email,
                    ).length
                  }{" "}
                  ραντεβού
                </small>
              </div>
              <ChevronRight size={16} />
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function AuthModal({ mode, onClose, onModeChange }) {
  const dialogRef = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    const focusableSelector = "button:not(:disabled), input:not(:disabled), a[href]";
    dialogRef.current?.querySelector("input")?.focus();
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = dialogRef.current?.querySelectorAll(focusableSelector);
      if (!focusable?.length) return;
      if (event.shiftKey && document.activeElement === focusable[0]) {
        event.preventDefault();
        focusable[focusable.length - 1].focus();
      } else if (!event.shiftKey && document.activeElement === focusable[focusable.length - 1]) {
        event.preventDefault();
        focusable[0].focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previous?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="home-auth-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section ref={dialogRef} className="home-auth-modal" role="dialog" aria-modal="true" aria-labelledby="home-auth-title">
        <div className="home-auth-modal-heading">
          <span className="home-auth-modal-mark">B</span>
          <span id="home-auth-title">{mode === "login" ? "Σύνδεση επαγγελματία" : "Εγγραφή επαγγελματία"}</span>
          <button type="button" className="home-auth-close" aria-label="Κλείσιμο παραθύρου" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <AuthPage
          mode={mode}
          modal
          onModeChange={onModeChange}
          onAuthenticated={onClose}
        />
      </section>
    </div>
  );
}

function AuthPage({ mode, customer = false, modal = false, onModeChange, onAuthenticated }) {
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    email: "",
    password: "",
    businessName: "",
  });
  const submit = async (event) => {
    event.preventDefault();
    if (loading) return;
    setLoading(true);
    setError("");
    if (mode === "register") {
      const validationError = validateRegistration({
        accountType: "professional",
        email: form.email,
        password: form.password,
        businessName: form.businessName,
      });
      if (validationError) {
        setError(validationError);
        setLoading(false);
        return;
      }
    }
    let authenticated = false;
    try {
      if (!supabase) {
        setError(SUPABASE_CONFIG_ERROR);
        return;
      }
      const result =
        mode === "login"
          ? await supabase.auth.signInWithPassword({
              email: form.email,
              password: form.password,
            })
          : await supabase.auth.signUp({
              email: form.email,
              password: form.password,
              options: {
                data: {
                  account_type: "professional",
                  business_name: form.businessName.trim(),
                },
              },
            });
      if (result.error) {
        setError(registrationAuthError(result.error) || errorText(result.error));
        return;
      }
      authenticated = Boolean(result.data.user);
      if (mode === "register" && result.data.user) {
        if (!result.data.session) {
          setError(
            "Ελέγξτε το email σας για επιβεβαίωση. Μετά την επιβεβαίωση, συνδεθείτε για να ολοκληρωθεί η δημιουργία του χώρου σας.",
          );
          return;
        }
      }
      const user = result.data.user;
      if (
        !customer && user &&
        (mode === "register" || user.user_metadata?.account_type === "professional" || user.user_metadata?.business_name)
      ) await ensureProfessionalBusiness(supabase, user, slugify);
      onAuthenticated?.();
      navigate(customer ? "/customer" : "/dashboard");
    } catch (requestError) {
      reportCriticalError(requestError, {
        feature: "professional-authentication",
        operation: mode,
      });
      setError(authenticated
        ? "Η σύνδεση ολοκληρώθηκε, αλλά δεν δημιουργήθηκε ο επαγγελματικός χώρος. Συνδεθείτε ξανά για να επαναλάβετε την προσπάθεια."
        : "Δεν ήταν δυνατή η ολοκλήρωση της σύνδεσης. Ελέγξτε τα στοιχεία σας και δοκιμάστε ξανά.");
    } finally {
      setLoading(false);
    }
  };
  const authPath = customer ? "/customer-" : "/";
  return (
    <div className={`auth-layout${modal ? " home-auth-layout" : ""}`}>
      <div className="auth-aside">
        <div className="auth-brand-row"><Link className="brand light" to="/">
          <span className="brand-mark">B</span>
          <span>
            book<span>easy</span>
          </span>
        </Link></div>
        <div>
          <span className="eyebrow">Η ΠΛΑΤΦΟΡΜΑ ΓΙΑ ΤΟ ΕΠΟΜΕΝΟ ΡΑΝΤΕΒΟΥ</span>
          <h1>
            Λιγότερη διαχείριση.
            <br />
            <em>Περισσότερη</em> επιχείρηση.
          </h1>
          <p>
            Όλα τα ραντεβού, οι πελάτες και η ομάδα σας, σε έναν όμορφο και
            εύχρηστο χώρο εργασίας.
          </p>
        </div>
        <small>© {new Date().getFullYear()} BookEasy</small>
      </div>
      <div className="auth-form-wrap">
        <form className="auth-form" onSubmit={submit}>
          <span className="eyebrow">
            {mode === "login" ? "ΚΑΛΩΣ ΗΡΘΑΤΕ ΠΙΣΩ" : "ΞΕΚΙΝΗΣΤΕ ΔΩΡΕΑΝ"}
          </span>
          <h2>
            {customer
              ? "Ο λογαριασμός πελάτη σας"
              : mode === "login"
                ? "Σύνδεση στον λογαριασμό σας"
                : "Δημιουργήστε τον χώρο σας"}
          </h2>
          <p>
            {mode === "login"
              ? "Συνεχίστε από εκεί που σταματήσατε."
              : "Έτοιμοι σε λιγότερο από 2 λεπτά."}
          </p>
          <Notice message={error} />
          {mode === "register" && !customer && (
            <label>
              Όνομα επιχείρησης
              <input
                value={form.businessName}
                onChange={(e) =>
                  setForm({ ...form, businessName: e.target.value })
                }
                required
              />
            </label>
          )}
          <label>
            Email
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              required
            />
          </label>
          <label>
            Κωδικός
            <input
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              minLength="6"
              required
            />
          </label>
          <button className="primary-button full" disabled={loading}>
            {loading
              ? "Φόρτωση..."
              : mode === "login"
                ? "Σύνδεση"
                : "Δημιουργία λογαριασμού"}{" "}
            <ChevronRight size={17} />
          </button>
          <small className="auth-switch">
            {mode === "login"
              ? "Δεν έχετε λογαριασμό;"
              : "Έχετε ήδη λογαριασμό;"}{" "}
            {modal ? (
              <button type="button" className="home-auth-switch" onClick={() => onModeChange(mode === "login" ? "register" : "login")}>
                {mode === "login" ? "Εγγραφή" : "Σύνδεση"}
              </button>
            ) : (
              <Link to={`${authPath}${mode === "login" ? "register" : "login"}`}>
                {mode === "login" ? "Εγγραφή" : "Σύνδεση"}
              </Link>
            )}
          </small>
        </form>
      </div>
    </div>
  );
}

function PublicBooking() {
  return null;
  /*
  const { slug } = useParams();
  const [business, setBusiness] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [services, setServices] = useState([]);
  const [staff, setStaff] = useState([]);
  const [hours, setHours] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [selectedService, setSelectedService] = useState(null);
  const [selectedStaff, setSelectedStaff] = useState(null);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [time, setTime] = useState("");
  const [done, setDone] = useState(false);
  const [bookingError, setBookingError] = useState("");
  useEffect(() => {
    async function load() {
      if (!supabase || !isSupabaseConfigured) {
        setError(SUPABASE_CONFIG_ERROR);
        setLoading(false);
        return;
      }
      const result = await supabase
        .from("businesses")
        .select("*")
        .eq("slug", slug)
        .maybeSingle();
      if (result.error || !result.data) {
        setError("Η επιχείρηση δεν βρέθηκε.");
        setLoading(false);
        return;
      }
      setBusiness(result.data);
      const [serviceResult, staffResult, hoursResult] = await Promise.all([
        supabase
          .from("services")
          .select("*")
          .eq("business_id", result.data.id)
          .eq("is_active", true),
        supabase
          .from("staff")
          .select("*")
          .eq("business_id", result.data.id)
          .eq("is_active", true),
        supabase
          .from("working_hours")
          .select("*")
          .eq("business_id", result.data.id),
      ]);
      setServices(serviceResult.data || []);
      setStaff(staffResult.data || []);
      if (hoursResult.data?.length) setHours(hoursResult.data);
      setSelectedService(serviceResult.data?.[0] || null);
      setSelectedStaff(staffResult.data?.[0] || null);
      setLoading(false);
    }
    load();
  }, [slug]);
  useEffect(() => {
    async function loadAppointments() {
      if (supabase && business?.id && selectedStaff) {
        const { data } = await supabase
          .from("appointments")
          .select("starts_at, ends_at")
          .eq("business_id", business.id)
          .eq("staff_id", selectedStaff.id)
          .neq("status", "cancelled")
          .gte("starts_at", `${date}T00:00:00`)
          .lte("starts_at", `${date}T23:59:59`);
        setAppointments(data || []);
      }
    }
    loadAppointments();
  }, [business, date, selectedStaff]);
  const slots = useMemo(
    () => getAvailableSlots(date, selectedService, hours, appointments),
    [date, selectedService, hours, appointments],
  );
  const book = async () => {
    setBookingError("");
    if (!selectedService || !selectedStaff || !time) {
      setBookingError("Επιλέξτε διαθέσιμη ώρα.");
      return;
    }
    const starts = new Date(`${date}T${time}:00`);
    const ends = new Date(
      starts.getTime() + selectedService.duration_minutes * 60000,
    );
    if (!supabase || !isSupabaseConfigured) {
      setBookingError(SUPABASE_CONFIG_ERROR);
      return;
    }
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) {
      setBookingError("Συνδεθείτε για να κλείσετε ραντεβού.");
      return;
    }
    {
      const { data: authData } = await supabase.auth.getUser();
      const { error: insertError } = await supabase
        .from("appointments")
        .insert({
          business_id: business.id,
          service_id: selectedService.id,
          staff_id: selectedStaff.id,
          customer_id: authData.user.id,
          appointment_date: date,
          start_time: time,
          end_time: `${String(ends.getHours()).padStart(2, "0")}:${String(ends.getMinutes()).padStart(2, "0")}:00`,
          customer_phone: null,
          customer_name:
            authData.user.user_metadata?.full_name || authData.user.email,
          customer_email: authData.user.email,
          starts_at: starts.toISOString(),
          ends_at: ends.toISOString(),
          status: "pending",
        });
      if (insertError) {
        setBookingError(errorText(insertError));
        return;
      }
    }
    setDone(true);
  };
  if (loading) return <Loading />;
  if (error)
    return (
      <div className="loading-state">
        <Notice message={error} />
      </div>
    );
  return (
    <div className="public-page">
      <header className="public-header">
        <Link className="brand" to="/">
          <span className="brand-mark">B</span>
          <span>
            book<span>easy</span>
          </span>
        </Link>
        <Link className="public-login" to="/login">
          Είμαι επαγγελματίας <ChevronRight size={15} />
        </Link>
      </header>
      <main className="booking-layout">
        <section className="business-intro">
          <div className="business-hero-logo">{business.name[0]}</div>
          <h1>{business.name}</h1>
          <p>{business.description}</p>
          <div className="business-facts">
            <span>⌖ {business.address}</span>
            <span>◷ Δευ–Σαβ, 09:00–18:00</span>
            <span>☎ {business.phone}</span>
          </div>
          <div className="photo-strip">
            <div />
            <div />
            <div />
          </div>
        </section>
        <section className="booking-card">
          {done ? (
            <div className="success-state">
              <div className="success-icon">✓</div>
              <span className="eyebrow">ΤΟ ΡΑΝΤΕΒΟΥ ΚΛΕΙΣΤΗΚΕ</span>
              <h2>Τα λέμε σύντομα!</h2>
              <p>
                Το αίτημά σας για <strong>{selectedService.name}</strong> στις{" "}
                {date} στις {time} καταχωρήθηκε.
              </p>
            </div>
          ) : (
            <>
              <div className="booking-title">
                <span className="eyebrow">ΚΛΕΙΣΤΕ ΡΑΝΤΕΒΟΥ</span>
                <h2>Βρείτε την ώρα σας</h2>
                <p>Επιλέξτε υπηρεσία, επαγγελματία και ώρα.</p>
              </div>
              <label>
                Υπηρεσία
                <select
                  value={selectedService?.id || ""}
                  onChange={(e) =>
                    setSelectedService(
                      services.find((item) => item.id === e.target.value),
                    )
                  }
                >
                  {services.map((service) => (
                    <option value={service.id} key={service.id}>
                      {service.name} · {service.price}€
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Επαγγελματίας
                <select
                  value={selectedStaff?.id || ""}
                  onChange={(e) =>
                    setSelectedStaff(
                      staff.find((item) => item.id === e.target.value),
                    )
                  }
                >
                  {staff.map((person) => (
                    <option value={person.id} key={person.id}>
                      {person.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Ημερομηνία
                <input
                  type="date"
                  value={date}
                  min={new Date().toISOString().slice(0, 10)}
                  onChange={(e) => {
                    setDate(e.target.value);
                    setTime("");
                  }}
                />
              </label>
              <div>
                <span className="field-label">Διαθέσιμες ώρες</span>
                <div className="slot-grid">
                  {slots.map((slot) => (
                    <button
                      type="button"
                      className={slot === time ? "selected" : ""}
                      onClick={() => setTime(slot)}
                      key={slot}
                    >
                      {slot}
                    </button>
                  ))}
                  {!slots.length && (
                    <small>Δεν υπάρχουν διαθέσιμες ώρες.</small>
                  )}
                </div>
              </div>
              <Notice message={bookingError} />
              <div className="booking-summary">
                <span>
                  {selectedService?.name}
                  <small>
                    {selectedStaff?.name} · {selectedService?.duration_minutes}{" "}
                    λεπτά
                  </small>
                </span>
                <strong>{selectedService?.price}€</strong>
              </div>
              <button className="primary-button full" onClick={book}>
                Επιβεβαίωση ραντεβού <ChevronRight size={17} />
              </button>
            </>
          )}
        </section>
      </main>
    </div>
  );
  */
}
function CustomerAppointments() {
  const { user } = useAuth();
  const store = useData("appointments", user?.id, {
    column: "customer_id",
    select: "*, service:services(name), staff:staff(name)",
  });
  const cancel = async (id) => {
    if (supabase) {
      await supabase
        .from("appointments")
        .update({ status: "cancelled" })
        .eq("id", id)
        .eq("customer_id", user.id);
      store.reload();
    }
  };
  return (
    <div className="customer-page">
      <header className="public-header">
        <Link className="brand" to="/">
          <span className="brand-mark">B</span>
          <span>
            book<span>easy</span>
          </span>
        </Link>
        <Link className="public-login" to="/dashboard">
          Πίσω στον χώρο εργασίας
        </Link>
      </header>
      <main className="customer-content">
        <PageHeader
          eyebrow="ΤΑ ΡΑΝΤΕΒΟΥ ΜΟΥ"
          title="Οι κρατήσεις μου"
          subtitle="Δείτε τα επόμενα ραντεβού σας σε ένα σημείο."
        />
        {store.loading ? (
          <Loading />
        ) : (
          <div className="customer-appointments">
            {store.data.map((appointment) => (
              <div className="customer-appointment" key={appointment.id}>
                <div className="date-tile">
                  <b>{new Date(appointment.starts_at).getDate()}</b>
                  <span>
                    {new Date(appointment.starts_at).toLocaleDateString(
                      "el-GR",
                      { month: "short" },
                    )}
                  </span>
                </div>
                <div>
                  <strong>{appointment.service?.name || "Ραντεβού"}</strong>
                  <span>
                    {new Date(appointment.starts_at).toLocaleString("el-GR")}
                  </span>
                  <small>{appointment.status}</small>
                </div>
                {appointment.status !== "cancelled" && (
                  <button
                    className="outline-button"
                    onClick={() => cancel(appointment.id)}
                  >
                    Ακύρωση
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
export default App;
