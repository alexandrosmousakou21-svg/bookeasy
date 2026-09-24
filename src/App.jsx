import { useEffect, useMemo, useState } from "react";
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
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Copy,
  LayoutDashboard,
  LogOut,
  Menu,
  Plus,
  Scissors,
  Settings,
  Sparkles,
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
import {
  CustomerAppointmentsPage,
  CustomerAuth,
  CustomerBooking,
  CustomerHome,
  CustomerProfile,
} from "./customer";

const dayNames = [
  "Κυριακή",
  "Δευτέρα",
  "Τρίτη",
  "Τετάρτη",
  "Πέμπτη",
  "Παρασκευή",
  "Σάββατο",
];
const errorText = (error) =>
  error?.code === "23P01"
    ? "Η ώρα έχει ήδη κρατηθεί. Επιλέξτε άλλη διαθέσιμη ώρα."
    : error?.message || "Παρουσιάστηκε σφάλμα. Δοκιμάστε ξανά.";
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
    supabase.auth.getSession().then(({ data }) => {
      if (active) {
        setSession(data.session);
        setLoading(false);
      }
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
    const { data: rows, error: requestError } = await supabase
      .from(table)
      .select(options.select || "*")
      .eq(options.column || "business_id", id)
      .order(options.order || "created_at", {
        ascending: options.order === "day_of_week" || options.order === "name",
      });
    setError(requestError ? errorText(requestError) : "");
    setData(rows || []);
    setLoading(false);
    return rows || [];
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
    if (returnTo) sessionStorage.setItem("bookeasy-return-to", returnTo);
  }, []);
  useEffect(() => {
    const returnTo = sessionStorage.getItem("bookeasy-return-to");
    if (auth.user && returnTo) {
      sessionStorage.removeItem("bookeasy-return-to");
      navigate(returnTo, { replace: true });
    }
  }, [auth.user, navigate]);
  return <CustomerAuth mode={mode} />;
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
      const { data, error } = await supabase
        .from("businesses")
        .select("*")
        .eq("owner_id", auth.user.id)
        .maybeSingle();
      if (active) {
        setBusiness(data);
        setBusinessError(error ? errorText(error) : "");
        setBusinessLoading(false);
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
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/login" element={<AuthPage mode="login" />} />
      <Route path="/register" element={<AuthPage mode="register" />} />
      <Route path="/customer" element={<CustomerHome />} />
      <Route
        path="/customer-login"
        element={<CustomerAuthRedirect mode="login" />}
      />
      <Route
        path="/customer-register"
        element={<CustomerAuthRedirect mode="register" />}
      />
      <Route path="/customer/profile" element={<CustomerProfile />} />
      <Route path="/book/:slug" element={<CustomerBooking />} />
      <Route path="/b/:slug" element={<CustomerBooking />} />
      <Route path="/my-appointments" element={<CustomerAppointmentsPage />} />
      <Route
        path="/dashboard/*"
        element={
          <Protected>
            <Dashboard
              business={business}
              setBusiness={setBusiness}
              businessLoading={businessLoading}
              businessError={businessError}
              logout={logout}
            />
          </Protected>
        }
      />
      <Route path="*" element={<NavigateHome user={auth.user} />} />
    </Routes>
  );
}
function HomePage() {
  return (
    <div className="auth-layout">
      <div className="auth-aside">
        <Link className="brand light" to="/">
          <span className="brand-mark">B</span>
          <span>
            book<span>easy</span>
          </span>
        </Link>
        <div>
          <span className="eyebrow">BOOKEASY</span>
          <h1>Η Νο1 εφαρμογή κρατήσεων</h1>
          <p>
            Κλείσε εύκολα το επόμενο ραντεβού σου ή διαχειρίσου την επιχείρησή
            σου μέσα από μία απλή και σύγχρονη πλατφόρμα.
          </p>
        </div>
        <small>© 2025 BookEasy</small>
      </div>
      <div className="auth-form-wrap">
        <div className="auth-form">
          <span className="eyebrow">ΚΑΛΩΣ ΗΡΘΑΤΕ ΣΤΟ BOOKEASY</span>
          <h2>Πώς θέλετε να συνεχίσετε;</h2>
          <p>Επιλέξτε τον λογαριασμό που θέλετε να χρησιμοποιήσετε.</p>
          <Link className="primary-button full" to="/customer-login">
            Είμαι Πελάτης <ChevronRight size={17} />
          </Link>
          <Link className="outline-button full" to="/login">
            Είμαι Επαγγελματίας <ChevronRight size={17} />
          </Link>
        </div>
      </div>
    </div>
  );
}
function NavigateHome({ user }) {
  const navigate = useNavigate();
  useEffect(
    () =>
      navigate(user ? "/dashboard" : "/login", {
        replace: true,
      }),
    [navigate, user],
  );
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
  const location = useLocation();
  const page =
    navItems.find(
      (item) => item[0] !== "/" && location.pathname === item[0],
    )?.[1] || "Επισκόπηση";
  const appointments = useData("appointments", business?.id, {
    select: "*, service:services(name,duration_minutes), staff:staff(name)",
  });
  const hours = useData("working_hours", business?.id, {
    order: "day_of_week",
  });
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
    <div className="app-shell">
      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="sidebar-top">
          <Link className="brand" to="/dashboard">
            <span className="brand-mark">B</span>
            <span>
              book<span>easy</span>
            </span>
          </Link>
          <button
            className="icon-button mobile-only"
            onClick={() => setSidebarOpen(false)}
          >
            <X size={18} />
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
              <span>{label}</span>
              {label === "Ραντεβού" && <b>{appointments.data.length}</b>}
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
        <div className="content">
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
              path="profile"
              element={<PublicBooking />}
            />
            <Route
              path="settings"
              element={
                <Profile business={business} setBusiness={setBusiness} />
              }
            />
          </Routes>
        </div>
      </main>
    </div>
  );
}

function PageHeader({ eyebrow, title, subtitle, action }) {
  return (
    <div className="page-header">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      {action}
    </div>
  );
}
function StatCard({ icon: Icon, label, value, trend, tone }) {
  return (
    <article className="stat-card">
      <div className={`stat-icon ${tone}`}>
        <Icon size={18} />
      </div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small className="trend">↗ {trend}</small>
      </div>
    </article>
  );
}
function Overview({ appointments, business, hours }) {
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
    appointments.data.map((appointment) => appointment.customer_id),
  ).size;
  const serviceCount = new Set(
    appointments.data.map((appointment) => appointment.service_id),
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
        title="Καλημέρα"
        subtitle={`Μια γρήγορη ματιά στο ${business.name} σήμερα.`}
        action={
          <Link className="primary-button" to={`/b/${business.slug}`}>
            <Plus size={17} /> Νέο ραντεβού
          </Link>
        }
      />
      <div className="stats-grid">
        <StatCard
          icon={CalendarDays}
          label="Σημερινά ραντεβού"
          value={items.length}
          trend="Ενημερωμένα από τη βάση"
          tone="blue"
        />
        <StatCard
          icon={Users}
          label="Ενεργοί πελάτες"
          value={customerCount}
          trend="Με ραντεβού"
          tone="green"
        />
        <StatCard
          icon={Scissors}
          label="Υπηρεσίες"
          value={serviceCount}
          trend="Σε ραντεβού"
          tone="orange"
        />
        <StatCard
          icon={Clock3}
          label="Ραντεβού εβδομάδας"
          value={weekItems.length}
          trend="Συνολικές κρατήσεις"
          tone="violet"
        />
      </div>
      <div className="dashboard-grid">
        <section className="panel schedule">
          <div className="panel-heading">
            <div>
              <h2>Σημερινό πρόγραμμα</h2>
              <p>
                {appointments.loading
                  ? "Φόρτωση..."
                  : `${items.length} ραντεβού για σήμερα`}
              </p>
            </div>
            <Link to="/dashboard/calendar" className="text-link">
              Προβολή ημερολογίου <ChevronRight size={15} />
            </Link>
          </div>
          {appointments.loading ? (
            <Loading />
          ) : (
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
          <div className="available-banner">
            <div className="check-circle">✓</div>
            <div>
              <strong>Είστε διαθέσιμοι</strong>
              <span>Δέχεστε νέα ραντεβού</span>
            </div>
            <span className="toggle on">
              <i />
            </span>
          </div>
          <div className="hours-list">
            {hours.data
              .filter((day) => !day.staff_id)
              .slice(0, 5)
              .map((day) => (
              <div key={day.name}>
                <span>{dayNames[day.day_of_week]}</span>
                <strong>
                  {day.is_closed
                    ? "Κλειστά"
                    : `${day.start_time} – ${day.end_time}`}
                </strong>
              </div>
            ))}
          </div>
          <Link to="/dashboard/settings" className="outline-button">
            Επεξεργασία ωραρίου <ChevronRight size={15} />
          </Link>
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
        <button className="icon-button" onClick={() => shiftWeek(-1)}>
          <ChevronLeft size={18} />
        </button>
        <strong>
          {isCurrentWeek
            ? "Αυτή η εβδομάδα"
            : `${weekDays[0].toLocaleDateString("el-GR", { day: "numeric", month: "short" })} – ${weekDays[6].toLocaleDateString("el-GR", { day: "numeric", month: "short" })}`}
        </strong>
        <button className="icon-button" onClick={() => shiftWeek(1)}>
          <ChevronRight size={18} />
        </button>
        <button className="outline-button today" onClick={resetWeek}>
          Σήμερα
        </button>
      </div>
      <section className="panel calendar-panel">
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
      </section>
    </>
  );
}
function Appointments({ appointments }) {
  const update = async (id, status) => {
    if (supabase) {
      const { error } = await supabase
        .from("appointments")
        .update({ status })
        .eq("id", id);
      if (error) alert(errorText(error));
      else appointments.reload();
    }
  };
  const remove = async (id) => {
    if (supabase) {
      const { error } = await supabase
        .from("appointments")
        .delete()
        .eq("id", id);
      if (error) alert(errorText(error));
      else appointments.reload();
    }
  };
  return (
    <>
      <PageHeader
        eyebrow="ΡΑΝΤΕΒΟΥ"
        title="Όλα τα ραντεβού"
        subtitle="Παρακολουθήστε τις κρατήσεις της επιχείρησής σας."
      />
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
            ) : (
              appointments.data.map((item) => (
                <tr key={item.id}>
                  <td>
                    <div className="table-person">
                      <div className="avatar pink">
                        {(item.customer_name || "").slice(0, 2)}
                      </div>
                      <strong>{item.customer_name}</strong>
                    </div>
                  </td>
                  <td>{item.service?.name || "Υπηρεσία"}</td>
                  <td>
                    {new Date(item.starts_at).toLocaleString("el-GR", {
                      dateStyle: "short",
                      timeStyle: "short",
                    })}
                  </td>
                  <td>{item.staff?.name || "—"}</td>
                  <td>
                    <span className={`status ${item.status}`}>
                      {item.status}
                    </span>
                  </td>
                  <td>
                    <button
                      className="mini-action"
                      onClick={() => update(item.id, "confirmed")}
                    >
                      ✓
                    </button>
                    <button
                      className="mini-action"
                      onClick={() => update(item.id, "completed")}
                    >
                      ○
                    </button>
                    <button
                      className="mini-action danger"
                      onClick={() => remove(item.id)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>
    </>
  );
}

function Editor({ title, value, fields, onClose, onSave }) {
  const [form, setForm] = useState(value);
  return (
    <div className="modal-backdrop open">
      <div className="modal">
        <div className="modal-header">
          <div>
            <span className="eyebrow">ΕΠΕΞΕΡΓΑΣΙΑ</span>
            <h2>{title}</h2>
          </div>
          <button className="icon-button" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSave(form);
          }}
        >
          {fields.map(([key, label]) => (
            <label key={key}>
              {label}
              {key === "description" ? (
                <textarea
                  value={form[key] || ""}
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
              onChange={(e) =>
                setForm({ ...form, is_active: e.target.checked })
              }
            />{" "}
            Ενεργό
          </label>
          <div className="modal-footer">
            <button type="button" className="outline-button" onClick={onClose}>
              Άκυρο
            </button>
            <button className="primary-button">Αποθήκευση</button>
          </div>
        </form>
      </div>
    </div>
  );
}
function Services({ business }) {
  const store = useData("services", business.id, { order: "name" });
  const [editing, setEditing] = useState(null);
  const save = async (form) => {
    const payload = {
      business_id: business.id,
      name: form.name,
      description: form.description,
      duration_minutes: Number(form.duration_minutes),
      price: Number(form.price),
      is_active: form.is_active,
    };
    const request = form.id
      ? supabase.from("services").update(payload).eq("id", form.id)
      : supabase.from("services").insert(payload);
    const { error } = await request;
    if (error) alert(errorText(error));
    else {
      setEditing(null);
      store.reload();
    }
  };
  const remove = async (id) => {
    const { error } = await supabase.from("services").delete().eq("id", id);
    if (error) alert(errorText(error));
    else store.reload();
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
        />
      )}
    </>
  );
}
function Staff({ business }) {
  const store = useData("staff", business.id, { order: "name" });
  const [editing, setEditing] = useState(null);
  const [hoursFor, setHoursFor] = useState(null);
  const save = async (form) => {
    const payload = {
      business_id: business.id,
      name: form.name,
      description: form.description,
      is_active: form.is_active,
    };
    const request = form.id
      ? supabase.from("staff").update(payload).eq("id", form.id)
      : supabase.from("staff").insert(payload);
    const { error } = await request;
    if (error) alert(errorText(error));
    else {
      setEditing(null);
      store.reload();
    }
  };
  const remove = async (id) => {
    const { error } = await supabase.from("staff").delete().eq("id", id);
    if (error) alert(errorText(error));
    else store.reload();
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

function StaffHoursEditor({ business, staffMember, onClose }) {
  const [hours, setHours] = useState([]);
  const [message, setMessage] = useState("");
  useEffect(() => {
    async function load() {
      const { data, error } = await supabase
        .from("working_hours")
        .select("*")
        .eq("business_id", business.id)
        .eq("staff_id", staffMember.id)
        .order("day_of_week");
      if (error) {
        setMessage(errorText(error));
        return;
      }
      setHours(
        (data?.length
          ? data
          : dayNames.map((name, day_of_week) => ({
              name,
              day_of_week,
              start_time: "09:00:00",
              end_time: "18:00:00",
              is_closed: day_of_week === 0,
            })))
          .map((item) => ({ ...item, name: dayNames[item.day_of_week] })),
      );
    }
    load();
  }, [business.id, staffMember.id]);
  const save = async (event) => {
    event.preventDefault();
    const { error: deleteError } = await supabase
      .from("working_hours")
      .delete()
      .eq("business_id", business.id)
      .eq("staff_id", staffMember.id);
    if (deleteError) {
      setMessage(errorText(deleteError));
      return;
    }
    const { error: insertError } = await supabase.from("working_hours").insert(
      hours.map(({ id, name, ...hour }) => ({
        ...hour,
        business_id: business.id,
        staff_id: staffMember.id,
      })),
    );
    if (insertError) setMessage(errorText(insertError));
    else onClose();
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
          <div className="hours-editor">
            {hours.map((hour) => (
              <div key={hour.day_of_week}>
                <strong>{hour.name}</strong>
                <input
                  type="time"
                  disabled={hour.is_closed}
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
                  disabled={hour.is_closed}
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
          <div className="modal-footer">
            <button type="button" className="outline-button" onClick={onClose}>
              Άκυρο
            </button>
            <button className="primary-button">Αποθήκευση</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Profile({ business, setBusiness }) {
  const [form, setForm] = useState(business);
  const [message, setMessage] = useState("");
  const [hours, setHours] = useState([]);
  const [photos, setPhotos] = useState("");
  const [uploading, setUploading] = useState("");
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
      supabase
        .from("business_media")
        .select("url")
        .eq("business_id", business.id)
        .order("sort_order"),
    ]).then(([hourResult, mediaResult]) => {
      if (hourResult.error) setMessage(errorText(hourResult.error));
      setHours(
        (hourResult.data?.length ? hourResult.data : defaultHours).map((item) => ({
          ...item,
          name: dayNames[item.day_of_week],
        })),
      );
      if (mediaResult.error) setMessage(errorText(mediaResult.error));
      setPhotos((mediaResult.data || []).map((item) => item.url).join(", "));
    });
  }, [business.id]);
  const uploadMedia = async (file, folder) => {
    if (!file) return null;
    const extension = file.name.includes(".")
      ? file.name.split(".").pop().toLowerCase()
      : "jpg";
    const safeName = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${extension}`;
    const path = `${business.id}/${folder}/${safeName}`;

    const { error } = await supabase.storage
      .from("business-media")
      .upload(path, file, {
        cacheControl: "3600",
        upsert: false,
        contentType: file.type || undefined,
      });

    if (error) {
      setMessage(errorText(error));
      return null;
    }

    const { data } = supabase.storage
      .from("business-media")
      .getPublicUrl(path);

    return data.publicUrl;
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

  
const save = async (event) => {
    event.preventDefault();
    const { error } = await supabase
      .from("businesses")
      .update({
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
      })
      .eq("id", business.id);
    if (error) {
      setMessage(errorText(error));
      return;
    }
    const { error: hoursError } = await supabase
      .from("working_hours")
      .delete()
      .eq("business_id", business.id)
      .is("staff_id", null);
    if (hoursError) {
      setMessage(errorText(hoursError));
      return;
    }
    if (hours.length) {
      const { error: insertHoursError } = await supabase
        .from("working_hours")
        .insert(
          hours.map(({ name, id, ...hour }) => ({
            ...hour,
            business_id: business.id,
            staff_id: null,
          })),
        );
      if (insertHoursError) {
        setMessage(errorText(insertHoursError));
        return;
      }
    }
    const { error: mediaDeleteError } = await supabase
      .from("business_media")
      .delete()
      .eq("business_id", business.id);
    if (mediaDeleteError) {
      setMessage(errorText(mediaDeleteError));
      return;
    }
    const urls = photos
      .split(",")
      .map((url) => url.trim())
      .filter(Boolean);
    if (urls.length) {
      const { error: mediaInsertError } = await supabase
        .from("business_media")
        .insert(
          urls.map((url, sort_order) => ({
            business_id: business.id,
            url,
            sort_order,
          })),
        );
      if (mediaInsertError) {
        setMessage(errorText(mediaInsertError));
        return;
      }
    }
    setBusiness(form);
    setMessage("Οι αλλαγές αποθηκεύτηκαν.");
    setTimeout(() => setMessage(""), 3000);
  };
  return (
    <>
      <PageHeader
        eyebrow="ΠΡΟΦΙΛ ΕΠΙΧΕΙΡΗΣΗΣ"
        title="Η επιχείρησή σας"
        subtitle="Αυτές οι πληροφορίες εμφανίζονται στη δημόσια σελίδα σας."
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
                value={form.primary_color || "#1664d9"}
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
          <div className="form-actions">
            <button className="primary-button">Αποθήκευση αλλαγών</button>
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

function AuthPage({ mode, customer = false }) {
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
    setLoading(true);
    setError("");
    if (!supabase) {
      setError(SUPABASE_CONFIG_ERROR);
      setLoading(false);
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
            options: { data: { business_name: form.businessName } },
          });
    if (result.error) setError(errorText(result.error));
    else if (mode === "register" && result.data.user && !customer) {
      if (!result.data.session) {
        setError(
          "Ελέγξτε το email σας για επιβεβαίωση και μετά συνδεθείτε για να δημιουργήσετε τον χώρο σας.",
        );
        setLoading(false);
        return;
      }
      const baseSlug = slugify(form.businessName);
      let slug = baseSlug;
      let suffix = 2;
      while (true) {
        const { data: existing } = await supabase
          .from("businesses")
          .select("id")
          .eq("slug", slug)
          .maybeSingle();
        if (!existing) break;
        slug = `${baseSlug}-${suffix}`;
        suffix += 1;
      }
      const { error: businessError } = await supabase
        .from("businesses")
        .insert({
          owner_id: result.data.user.id,
          name: form.businessName,
          slug,
          description: "",
          address: "",
          phone: "",
        });
      if (businessError) setError(errorText(businessError));
      else navigate("/dashboard");
    } else navigate(customer ? "/my-appointments" : "/dashboard");
    setLoading(false);
  };
  const authPath = customer ? "/customer-" : "/";
  return (
    <div className="auth-layout">
      <div className="auth-aside">
        <Link className="brand light" to="/">
          <span className="brand-mark">B</span>
          <span>
            book<span>easy</span>
          </span>
        </Link>
        <div>
          <span className="eyebrow">Η ΠΛΑΤΦΟΡΜΑ ΓΙΑ ΤΟ ΕΠΟΜΕΝΟ ΡΑΝΤΕΒΟΥ</span>
          <h1>
            Λιγότερη διαχείριση.
            <br />
            <em>Περισσότερη</em> επιχείρηση.
          </h1>
          <p>
            Όλα τα ραντεβού, οι πελάτες και η ομάδα σας. Σε ένα όμορφο, απλό
            workspace.
          </p>
        </div>
        <small>© 2025 BookEasy</small>
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
            <Link to={`${authPath}${mode === "login" ? "register" : "login"}`}>
              {mode === "login" ? "Εγγραφή" : "Σύνδεση"}
            </Link>
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
