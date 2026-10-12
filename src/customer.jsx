import { useEffect, useMemo, useRef, useState } from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import {
  CalendarDays,
  ChevronRight,
  Clock3,
  LogOut,
  MessageCircle,
  Search,
  Send,
  UserRound,
  X,
} from "lucide-react";
import {
  supabase,
  isSupabaseConfigured,
  SUPABASE_CONFIG_ERROR,
} from "./lib/supabase";
import { invokeWithRetry } from "./lib/functions";
import { reportCriticalError } from "./lib/errorReporting";

const errorText = (error) =>
  error?.code === "23P01"
    ? "Η ώρα έχει ήδη κρατηθεί. Επιλέξτε άλλη διαθέσιμη ώρα."
    : "Παρουσιάστηκε πρόβλημα. Ελέγξτε τη σύνδεσή σας και δοκιμάστε ξανά.";
const safeReturnPath = (value, fallback = "/customer") => {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return fallback;
  return value;
};
const readSessionValue = (key) => {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
};
const writeSessionValue = (key, value) => {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // The current conversation remains usable in memory.
  }
};
const removeSessionValue = (key) => {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // Storage may be unavailable in private browsing.
  }
};
const dayNames = [
  "Κυριακή",
  "Δευτέρα",
  "Τρίτη",
  "Τετάρτη",
  "Πέμπτη",
  "Παρασκευή",
  "Σάββατο",
];
function businessToday(timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function businessDateTime(date, time, timeZone) {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const target = Date.UTC(year, month - 1, day, hour, minute);
  let timestamp = target;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(timestamp));
    const values = Object.fromEntries(parts.map((part) => [part.type, Number(part.value)]));
    const localAsUtc = Date.UTC(
      values.year,
      values.month - 1,
      values.day,
      values.hour,
      values.minute,
    );
    timestamp += target - localAsUtc;
  }
  return new Date(timestamp);
}

function useCustomerAuth() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(isSupabaseConfigured);
  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return undefined;
    }
    let active = true;
    supabase.auth
      .getUser()
      .then(({ data, error }) => {
        if (error) reportCriticalError(error, { feature: "customer-authentication", operation: "load-user" });
        if (active) {
          setUser(data.user);
          setLoading(false);
        }
      })
      .catch((error) => {
        reportCriticalError(error, { feature: "customer-authentication", operation: "load-user" });
        if (active) setLoading(false);
      });
    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, session) => setUser(session?.user || null),
    );
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);
  return { user, loading };
}
function CustomerLoading() {
  return (
    <div className="loading-state">
      <div className="loader" />
      <span>Φόρτωση...</span>
    </div>
  );
}
function CustomerNotice({ message, success = false }) {
  return message ? (
    <div className={`notice ${success ? "success" : ""}`}>{message}</div>
  ) : null;
}
function CustomerHeader({ user, onLogout }) {
  return (
    <header className="public-header">
      <Link className="brand" to="/">
        <span className="brand-mark">B</span>
        <span>
          book<span>easy</span>
        </span>
      </Link>
      <nav className="customer-nav">
        <Link to="/customer">Αναζήτηση</Link>
        {user ? (
          <>
            <Link to="/my-appointments">Τα ραντεβού μου</Link>
            <Link to="/customer/profile">Το προφίλ μου</Link>
            <Link to="/customer/support">Υποστήριξη πελατών</Link>
            <button className="customer-logout" onClick={onLogout}>
              <LogOut size={15} /> Αποσύνδεση
            </button>
          </>
        ) : (
          <>
            <Link to="/customer-login">Σύνδεση</Link>
            <Link className="primary-button compact" to="/customer-register">
              Εγγραφή
            </Link>
          </>
        )}
      </nav>
    </header>
  );
}
function CustomerShell({ children }) {
  const { user } = useCustomerAuth();
  const logout = async () => {
    if (supabase) await supabase.auth.signOut();
  };
  return (
    <div className="customer-page">
      <CustomerHeader user={user} onLogout={logout} />
      {children}
    </div>
  );
}

export function CustomerHome() {
  const [businesses, setBusinesses] = useState([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        if (!supabase || !isSupabaseConfigured) {
          setError(SUPABASE_CONFIG_ERROR);
          return;
        }
        const { data, error: requestError } = await supabase.rpc(
          "list_active_plus_businesses",
        );
        if (requestError) throw requestError;
        if (active) {
          setBusinesses(data || []);
          setError("");
        }
      } catch (requestError) {
        reportCriticalError(requestError, {
          feature: "customer-directory",
          operation: "load-businesses",
        });
        if (active) {
          setBusinesses([]);
          setError("Δεν ήταν δυνατή η φόρτωση των επιχειρήσεων. Δοκιμάστε ξανά.");
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => {
      active = false;
    };
  }, []);
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = normalizedQuery
    ? businesses.filter((business) =>
        `${business.name} ${business.description || ""} ${business.address || ""} ${business.city || ""} ${business.category || ""}`
          .toLowerCase()
          .includes(normalizedQuery),
      )
    : businesses;
  const content = (
    <>
      <main className="customer-home">
        <section className="customer-hero">
          <span className="eyebrow">BOOKEASY</span>
          <h1>
            Βρείτε το επόμενο
            <br />
            <em>ραντεβού σας.</em>
          </h1>
          <p>
            Ανακαλύψτε επιχειρήσεις και κλείστε εύκολα την ώρα που σας
            ταιριάζει.
          </p>
          <div className="customer-search">
            <Search size={19} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Αναζητήστε επιχείρηση ή περιοχή..."
            />
          </div>
        </section>
        <section className="customer-directory">
          <div className="directory-heading">
            <div>
              <span className="eyebrow">ΕΠΙΧΕΙΡΗΣΕΙΣ</span>
              <h2>Επιλέξτε πού θέλετε να πάτε</h2>
            </div>
            <span>{filtered.length} διαθέσιμες</span>
          </div>
          {error && <CustomerNotice message={error} />}
          {loading ? (
            <CustomerLoading />
          ) : (
            <div className="business-grid">
              {filtered.map((business) => (
                <Link
                  className="business-card"
                  to={`/b/${business.slug}`}
                  key={business.id}
                >
                  <div className="business-card-logo">
                    {business.logo_url ? (
                      <img src={business.logo_url} alt="" />
                    ) : (
                      business.name.slice(0, 1)
                    )}
                  </div>
                  <div>
                    <h3>{business.name}</h3>
                    <p>
                      {business.description ||
                        "Κλείστε το επόμενο ραντεβού σας online."}
                    </p>
                    <small>
                      {business.city || business.address || "Online κρατήσεις"}
                      {business.category ? ` · ${business.category}` : ""}{" "}
                      <ChevronRight size={14} />
                    </small>
                  </div>
                </Link>
              ))}
              {!filtered.length && (
                <div className="empty-state">
                  Δεν βρέθηκαν επιχειρήσεις με αυτά τα στοιχεία.
                </div>
              )}
            </div>
          )}
        </section>
      </main>
    </>
  );

  return <CustomerShell>{content}</CustomerShell>;
}

export function CustomerAuth({ mode }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const returnTo = safeReturnPath(searchParams.get("returnTo"));
  const [form, setForm] = useState({
    fullName: "",
    phone: "",
    email: "",
    password: "",
    confirmPassword: "",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const submit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError("");
    if (mode === "register" && form.password !== form.confirmPassword) {
      setError("Οι κωδικοί πρόσβασης δεν ταιριάζουν.");
      setLoading(false);
      return;
    }
    if (!supabase || !isSupabaseConfigured) {
      setError(SUPABASE_CONFIG_ERROR);
      setLoading(false);
      return;
    }
    try {
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
                  full_name: form.fullName,
                  phone: form.phone,
                  account_type: "customer",
                },
              },
            });
      if (result.error) {
        setError(errorText(result.error));
        return;
      }
      if (mode === "register" && !result.data.session) {
        setError(
          "Ελέγξτε το email σας για επιβεβαίωση και μετά συνδεθείτε για να συνεχίσετε.",
        );
        return;
      }
      if (mode === "register" && result.data.user) {
        const { error: profileError } = await supabase
          .from("customer_profiles")
          .insert({
            user_id: result.data.user.id,
            full_name: form.fullName,
            email: form.email,
            phone: form.phone,
          });
        if (profileError) {
          reportCriticalError(profileError, {
            feature: "customer-authentication",
            operation: "create-profile",
          });
          setError("Ο λογαριασμός δημιουργήθηκε, αλλά δεν φορτώθηκε το προφίλ. Συνδεθείτε ξανά.");
          return;
        }
      }
      navigate(returnTo);
    } catch (requestError) {
      reportCriticalError(requestError, {
        feature: "customer-authentication",
        operation: mode,
      });
      setError("Δεν ήταν δυνατή η σύνδεση. Ελέγξτε τα στοιχεία σας και δοκιμάστε ξανά.");
    } finally {
      setLoading(false);
    }
  };
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
          <span className="eyebrow">Ο ΛΟΓΑΡΙΑΣΜΟΣ ΠΕΛΑΤΗ ΣΑΣ</span>
          <h1>
            Το επόμενο
            <br />
            <em>ραντεβού</em> σας.
          </h1>
          <p>
            Ανακαλύψτε τις αγαπημένες σας επιχειρήσεις και κρατήστε τη θέση σας
            σε λίγα δευτερόλεπτα.
          </p>
        </div>
        <small>© 2025 BookEasy</small>
      </div>
      <div className="auth-form-wrap">
        <form className="auth-form" onSubmit={submit}>
          <span className="eyebrow">
            {mode === "login" ? "ΚΑΛΩΣ ΗΡΘΑΤΕ ΠΙΣΩ" : "ΔΗΜΙΟΥΡΓΙΑ ΛΟΓΑΡΙΑΣΜΟΥ"}
          </span>
          <h2>{mode === "login" ? "Σύνδεση" : "Εγγραφή πελάτη"}</h2>
          <p>
            {mode === "login"
              ? "Δείτε και διαχειριστείτε τα ραντεβού σας."
              : "Κρατήστε όλα τα ραντεβού σας σε ένα σημείο."}
          </p>
          <CustomerNotice message={error} />
          {mode === "register" && (
            <>
              <label>
                Ονοματεπώνυμο
                <input
                  value={form.fullName}
                  onChange={(event) =>
                    setForm({ ...form, fullName: event.target.value })
                  }
                  required
                />
              </label>
              <label>
                Τηλέφωνο
                <input
                  type="tel"
                  value={form.phone}
                  onChange={(event) =>
                    setForm({ ...form, phone: event.target.value })
                  }
                  required
                />
              </label>
            </>
          )}
          <label>
            Email
            <input
              type="email"
              value={form.email}
              onChange={(event) =>
                setForm({ ...form, email: event.target.value })
              }
              required
            />
          </label>
          <label>
            Κωδικός
            <input
              type="password"
              minLength="6"
              value={form.password}
              onChange={(event) =>
                setForm({ ...form, password: event.target.value })
              }
              required
            />
          </label>
          {mode === "register" && (
            <label>
              Επιβεβαίωση κωδικού
              <input
                type="password"
                minLength="6"
                value={form.confirmPassword}
                onChange={(event) =>
                  setForm({ ...form, confirmPassword: event.target.value })
                }
                required
              />
            </label>
          )}
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
            <Link
              to={`${mode === "login" ? "/customer-register" : "/customer-login"}?returnTo=${encodeURIComponent(returnTo)}`}
            >
              {mode === "login" ? "Εγγραφή" : "Σύνδεση"}
            </Link>
          </small>
        </form>
      </div>
    </div>
  );
}

async function loadBusinessData(slug) {
  if (!supabase || !isSupabaseConfigured)
    throw new Error(SUPABASE_CONFIG_ERROR);
  const { data: business, error } = await supabase
    .from("businesses")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();
  if (error || !business) throw new Error("Η επιχείρηση δεν βρέθηκε.");
  const [
    serviceResult,
    staffResult,
    hoursResult,
    mediaResult,
    assignmentResult,
    timeZoneResult,
  ] = await Promise.all([
    supabase
      .from("services")
      .select("*")
      .eq("business_id", business.id)
      .eq("is_active", true)
      .order("name"),
    supabase
      .from("staff")
      .select("*")
      .eq("business_id", business.id)
      .eq("is_active", true)
      .order("name"),
    supabase.from("working_hours").select("*").eq("business_id", business.id),
    supabase
      .from("business_media")
      .select("*")
      .eq("business_id", business.id)
      .order("sort_order"),
    supabase
      .from("staff_services")
      .select("staff_id,service_id")
      .eq("business_id", business.id),
    supabase.rpc("get_business_time_zone", { target_business: business.id }),
  ]);
  if (
    serviceResult.error ||
    staffResult.error ||
    hoursResult.error ||
    mediaResult.error ||
    assignmentResult.error
  )
    throw new Error(
      errorText(
        serviceResult.error ||
          staffResult.error ||
          hoursResult.error ||
          mediaResult.error ||
          assignmentResult.error,
      ),
    );
  if (timeZoneResult.error) {
    reportCriticalError(timeZoneResult.error, {
      feature: "booking-availability",
      operation: "load-business-timezone",
    });
  }
  let timeZone = timeZoneResult.data || "Europe/Athens";
  try {
    new Intl.DateTimeFormat("el-GR", { timeZone });
  } catch (timeZoneError) {
    reportCriticalError(timeZoneError, {
      feature: "booking-availability",
      operation: "validate-business-timezone",
    });
    timeZone = "Europe/Athens";
  }
  return {
    business,
    services: serviceResult.data || [],
    staff: staffResult.data || [],
    hours: hoursResult.data || [],
    media: mediaResult.data || [],
    assignments: assignmentResult.data || [],
    timeZone,
  };
}
function getSlots(date, service, staffMember, hours, appointments, timeZone) {
  if (!service || !staffMember) return [];
  const [year, month, dayOfMonth] = date.split("-").map(Number);
  const day = new Date(Date.UTC(year, month - 1, dayOfMonth)).getUTCDay();
  const businessHour = hours.find(
    (item) => Number(item.day_of_week) === day && !item.staff_id,
  );
  const staffHour = hours.find(
    (item) =>
      Number(item.day_of_week) === day && item.staff_id === staffMember.id,
  );
  const hour = staffHour || businessHour;
  if (!hour || hour.is_closed) return [];
  const [openHour, openMinute] = hour.start_time
    .slice(0, 5)
    .split(":")
    .map(Number);
  const [closeHour, closeMinute] = hour.end_time
    .slice(0, 5)
    .split(":")
    .map(Number);
  const slots = [];
  for (
    let minute = openHour * 60 + openMinute;
    minute + service.duration_minutes <= closeHour * 60 + closeMinute;
    minute += 30
  ) {
    const start = businessDateTime(
      date,
      `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`,
      timeZone,
    );
    const end = new Date(start.getTime() + service.duration_minutes * 60000);
    if (
      !appointments.some(
        (appointment) =>
          start < new Date(appointment.ends_at) &&
          end > new Date(appointment.starts_at),
      )
    )
      slots.push(
        `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`,
      );
  }
  return slots;
}

export function CustomerBooking({ dashboardMode = false, business: dashboardBusiness = null }) {
  const { slug: urlSlug } = useParams();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useCustomerAuth();
  const slug = dashboardMode ? dashboardBusiness?.slug : urlSlug;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [staffId, setStaffId] = useState("any");
  const [date, setDate] = useState(() => businessToday("Europe/Athens"));
  const [time, setTime] = useState("");
  const [appointments, setAppointments] = useState([]);
  const [details, setDetails] = useState({ name: "", phone: "", email: "" });
  const [bookingError, setBookingError] = useState("");
  const [success, setSuccess] = useState(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessage, setChatMessage] = useState("");
  const [chatMessages, setChatMessages] = useState([
    { sender_type: "assistant", body: "Γεια σας! Μπορείτε να ρωτήσετε για την επιχείρηση ή να μιλήσετε με εκπρόσωπο." },
  ]);
  const [chatMode, setChatMode] = useState("ai");
  const [chatNotice, setChatNotice] = useState("");
  const [chatError, setChatError] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [supportSession, setSupportSession] = useState(null);
  const supportRequest = useRef(null);
  const supportMessageRequest = useRef(null);
  const supportPolling = useRef(false);
  const [bookingSubmitting, setBookingSubmitting] = useState(false);
  const bookingPath = `/b/${encodeURIComponent(slug)}`;
  const fromDashboard =
    new URLSearchParams(window.location.search).get("from") === "dashboard";
  useEffect(() => {
    if (!data?.business?.id) return;
    const saved = readSessionValue(`bookeasy-support-${data.business.id}`);
    if (!saved) return;
    try {
      setSupportSession(JSON.parse(saved));
    } catch {
      removeSessionValue(`bookeasy-support-${data.business.id}`);
    }
  }, [data?.business?.id]);

  useEffect(() => {
    if (!supportSession?.conversation_id || !chatOpen) return undefined;
    let active = true;
    const refresh = async () => {
      if (supportPolling.current) return;
      supportPolling.current = true;
      try {
        const result = await invokeWithRetry(
          "customer-support",
          {
            body: {
              action: "get-messages",
              conversation_id: supportSession.conversation_id,
              access_token: supportSession.access_token,
            },
          },
          { feature: "customer-support", operation: "poll-conversation", attempts: 1, timeoutMs: 7000 },
        );
        if (!active) return;
        setChatMessages(result.messages || []);
        setSupportSession((current) => {
          if (!current || current.status === result.status) return current;
          const next = { ...current, status: result.status };
          writeSessionValue(`bookeasy-support-${data.business.id}`, JSON.stringify(next));
          return next;
        });
      } catch {
        if (active) setChatError("Δεν ήταν δυνατή η ανανέωση της συνομιλίας. Ελέγξτε τη σύνδεσή σας.");
      } finally {
        supportPolling.current = false;
      }
    };
    refresh();
    const timer = window.setInterval(refresh, 12000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [supportSession?.conversation_id, chatOpen, data?.business?.id]);

  const sendChatMessage = async (event) => {
    event?.preventDefault();
    const text = chatMessage.trim();
    if (!text || chatLoading || !data?.business) return;
    if (chatMode === "human" && !supportSession) {
      if (!details.name.trim() || (!details.email.trim() && !details.phone.trim())) {
        setChatError("Συμπληρώστε το όνομά σας και email ή τηλέφωνο για να σας απαντήσει η επιχείρηση.");
        return;
      }
      if (details.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(details.email.trim())) {
        setChatError("Συμπληρώστε έγκυρο email ή αφαιρέστε το email και δώστε τηλέφωνο.");
        return;
      }
    }

    const customerMessage = {
      sender_type: "customer",
      body: text,
      created_at: new Date().toISOString(),
    };
    let clientMessageId = null;
    let retryingSupportMessage = false;
    if (chatMode === "human" && supportSession) {
      const previous = supportMessageRequest.current;
      retryingSupportMessage =
        previous?.conversationId === supportSession.conversation_id &&
        previous?.text === text;
      clientMessageId = retryingSupportMessage
        ? previous.id
        : crypto.randomUUID();
      supportMessageRequest.current = {
        conversationId: supportSession.conversation_id,
        text,
        id: clientMessageId,
      };
    }
    if (!retryingSupportMessage) {
      setChatMessages((current) => [...current, customerMessage]);
    }
    setChatMessage("");
    setChatError("");
    setChatLoading(true);

    try {
      if (chatMode === "ai") {
        const result = await invokeWithRetry(
          "customer-assistant",
          { body: { business_slug: data.business.slug, message: text } },
          { feature: "customer-service-ai", operation: "answer-question", attempts: 1, timeoutMs: 48000 },
        );
        setChatMessages((current) => [
          ...current,
          {
            sender_type: "assistant",
            body: result?.reply || "Δεν έχω διαθέσιμη πληροφορία για αυτό.",
            offer_human: result?.offer_human === true,
            created_at: new Date().toISOString(),
          },
        ]);
        return;
      }

      if (supportSession) {
        const result = await invokeWithRetry(
          "customer-support",
          {
            body: {
              action: "send-message",
              conversation_id: supportSession.conversation_id,
              access_token: supportSession.access_token,
              client_message_id: clientMessageId,
              message: text,
            },
          },
          { feature: "customer-support", operation: "send-customer-message" },
        );
        supportMessageRequest.current = null;
        setChatMessages(result.messages || []);
        setSupportSession((current) => {
          if (!current) return current;
          const next = { ...current, status: result.status };
          writeSessionValue(`bookeasy-support-${data.business.id}`, JSON.stringify(next));
          return next;
        });
        setChatNotice("Το μήνυμά σας στάλθηκε στην επιχείρηση.");
        return;
      }

      supportRequest.current ||= {
        request_key: crypto.randomUUID(),
        access_token: crypto.randomUUID(),
      };
      const request = supportRequest.current;
      const transcript = [...chatMessages, customerMessage].map((item) => ({
        sender_type: item.sender_type,
        body: item.body,
      }));
      const result = await invokeWithRetry(
        "customer-support",
        {
          body: {
            action: "create-request",
            request_key: request.request_key,
            access_token: request.access_token,
            business_id: data.business.id,
            customer_name: details.name.trim(),
            customer_email: details.email.trim() || null,
            customer_phone: details.phone.trim() || null,
            messages: transcript,
          },
        },
        { feature: "customer-support", operation: "create-human-request" },
      );
      const session = {
        conversation_id: result.conversation_id,
        access_token: request.access_token,
        status: "new",
      };
      writeSessionValue(`bookeasy-support-${data.business.id}`, JSON.stringify(session));
      setSupportSession(session);
      setChatMode("human");
      supportRequest.current = null;
      setChatNotice("Το αίτημά σας παραλήφθηκε. Η επιχείρηση θα σας απαντήσει εδώ.");
      setChatMessages((current) => [
        ...current,
        { sender_type: "assistant", body: "Το αίτημά σας παραλήφθηκε. Θα ενημερωθείτε εδώ όταν απαντήσει η επιχείρηση.", created_at: new Date().toISOString() },
      ]);
    } catch (requestError) {
      reportCriticalError(requestError, {
        feature: chatMode === "ai" ? "customer-service-ai" : "customer-support",
        operation: chatMode === "ai" ? "answer-question" : "send-message",
      });
      setChatMessage(text);
      setChatError("Δεν ήταν δυνατή η αποστολή. Δοκιμάστε ξανά σε λίγο.");
      if (chatMode === "ai") {
        setChatMessages((current) => [
          ...current,
          { sender_type: "assistant", body: "Ο βοηθός δεν είναι προσωρινά διαθέσιμος. Μπορείτε να μιλήσετε με εκπρόσωπο.", offer_human: true, created_at: new Date().toISOString() },
        ]);
      }
    } finally {
      setChatLoading(false);
    }
  };

  const handleBookingClick = () => {
    if (!user) {
      navigate(`/customer-login?returnTo=${encodeURIComponent(bookingPath)}`);
      return;
    }
    document
      .querySelector(".booking-card")
      ?.scrollIntoView({ behavior: "smooth" });
  };
  useEffect(() => {
    if (dashboardMode && dashboardBusiness) {
      loadBusinessData(dashboardBusiness.slug)
        .then((result) => {
          setData(result);
          setServiceId(result.services[0]?.id || "");
          setDate(businessToday(result.timeZone));
          setLoading(false);
        })
        .catch((requestError) => {
          reportCriticalError(requestError, { feature: "booking", operation: "load-business" });
          setError("Η επιχείρηση δεν είναι διαθέσιμη αυτή τη στιγμή. Δοκιμάστε ξανά.");
          setLoading(false);
        });
      return;
    }

    loadBusinessData(slug)
      .then((result) => {
        setData(result);
        setServiceId(result.services[0]?.id || "");
        setDate(businessToday(result.timeZone));
        setLoading(false);
      })
      .catch((requestError) => {
        reportCriticalError(requestError, { feature: "booking", operation: "load-business" });
        setError("Η επιχείρηση δεν είναι διαθέσιμη αυτή τη στιγμή. Δοκιμάστε ξανά.");
        setLoading(false);
      });
  }, [slug, dashboardMode, dashboardBusiness]);
  useEffect(() => {
    if (user)
      setDetails({
        name: user.user_metadata?.full_name || "",
        phone: user.user_metadata?.phone || "",
        email: user.email || "",
      });
  }, [user]);
  const service = data?.services.find((item) => item.id === serviceId);
  const eligibleStaff =
    data?.staff.filter(
      (person) =>
        !data.assignments?.length ||
        data.assignments.some(
          (assignment) =>
            assignment.staff_id === person.id &&
            assignment.service_id === serviceId,
        ),
    ) || [];
  const selectedStaff =
    staffId === "any"
      ? eligibleStaff[0]
      : eligibleStaff.find((person) => person.id === staffId);
  useEffect(() => {
    let active = true;
    async function loadAppointments() {
      if (!data?.business?.id || !selectedStaff) {
        setAppointments([]);
        return;
      }
      try {
        const { data: rows, error: requestError } = await supabase.rpc(
          "get_booked_intervals",
          {
            target_business: data.business.id,
            target_staff: selectedStaff.id,
            target_date: date,
          },
        );
        if (requestError) throw requestError;
        if (active) {
          setBookingError("");
          setAppointments(rows || []);
        }
      } catch (requestError) {
        reportCriticalError(requestError, {
          feature: "booking-availability",
          operation: "load-booked-intervals",
        });
        if (active) {
          setBookingError("Δεν ήταν δυνατή η φόρτωση της διαθεσιμότητας. Δοκιμάστε ξανά.");
          setAppointments([]);
        }
      }
    }
    loadAppointments();
    return () => {
      active = false;
    };
  }, [data?.business?.id, date, selectedStaff?.id]);
  const slots = useMemo(
    () =>
      getSlots(date, service, selectedStaff, data?.hours || [], appointments, data?.timeZone || "Europe/Athens"),
    [date, service, selectedStaff, data?.hours, appointments, data?.timeZone],
  );
  const confirm = async () => {
    if (bookingSubmitting) return;
    setBookingError("");
    if (!user) {
      navigate(`/customer-login?returnTo=${encodeURIComponent(bookingPath)}`);
      return;
    }
    if (!supabase || !isSupabaseConfigured) {
      setBookingError(
        "Το Supabase δεν είναι ρυθμισμένο. Η κράτηση δεν καταχωρήθηκε.",
      );
      return;
    }
    if (
      !service ||
      !selectedStaff ||
      !time ||
      !details.name.trim() ||
      !details.phone.trim() ||
      !details.email.trim()
    ) {
      setBookingError(
        "Συμπληρώστε τα στοιχεία σας και επιλέξτε διαθέσιμη ώρα.",
      );
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(details.email.trim())) {
      setBookingError("Συμπληρώστε έγκυρη διεύθυνση email.");
      return;
    }
    if (details.phone.replace(/\D/g, "").length < 7) {
      setBookingError("Συμπληρώστε έγκυρο αριθμό τηλεφώνου.");
      return;
    }

    const requestStorageKey = [
      "bookeasy-booking",
      user.id,
      data.business.id,
      selectedStaff.id,
      service.id,
      date,
      time,
    ].join(":");
    let requestKey;
    try {
      requestKey = sessionStorage.getItem(requestStorageKey);
    } catch {
      // In-memory idempotency remains available when browser storage is disabled.
    }
    requestKey ||= crypto.randomUUID();
    try {
      sessionStorage.setItem(requestStorageKey, requestKey);
    } catch {
      // The database unique key still protects this page session.
    }

    const starts = businessDateTime(date, time, data.timeZone);
    const ends = new Date(starts.getTime() + service.duration_minutes * 60000);
    const [slotHour, slotMinute] = time.split(":").map(Number);
    const endMinuteOfDay = slotHour * 60 + slotMinute + service.duration_minutes;
    const endTime = `${String(Math.floor(endMinuteOfDay / 60)).padStart(2, "0")}:${String(endMinuteOfDay % 60).padStart(2, "0")}:00`;
    setBookingSubmitting(true);
    try {
      const { error: profileError } = await supabase
        .from("customer_profiles")
        .upsert(
          {
            user_id: user.id,
            full_name: details.name.trim(),
            phone: details.phone.trim(),
            email: details.email.trim(),
            business_id: data.business.id,
          },
          { onConflict: "user_id,business_id" },
        );
      if (profileError) throw profileError;

      let { data: createdAppointment, error: insertError } = await supabase
        .from("appointments")
        .insert({
          request_key: requestKey,
          business_id: data.business.id,
          customer_id: user.id,
          staff_id: selectedStaff.id,
          service_id: service.id,
          appointment_date: date,
          start_time: time,
          end_time: endTime,
          status: "booked",
          customer_name: details.name.trim(),
          customer_phone: details.phone.trim(),
          customer_email: details.email.trim(),
          starts_at: starts.toISOString(),
          ends_at: ends.toISOString(),
        })
        .select("id")
        .single();

      if (insertError?.code === "23505") {
        const existing = await supabase
          .from("appointments")
          .select("id")
          .eq("request_key", requestKey)
          .eq("customer_id", user.id)
          .maybeSingle();
        if (!existing.data || existing.error) throw insertError;
        createdAppointment = existing.data;
        insertError = null;
      }
      if (insertError) throw insertError;

      setSuccess({
        appointmentId: createdAppointment.id,
        business: data.business.name,
        service: service.name,
        staff: selectedStaff.name,
        date,
        time,
        price: service.price,
      });
      try {
        sessionStorage.removeItem(requestStorageKey);
      } catch {
        // The successful booking is already persisted.
      }
    } catch (requestError) {
      reportCriticalError(requestError, {
        feature: "booking",
        operation: "create-appointment",
      });
      setBookingError(errorText(requestError));
    } finally {
      setBookingSubmitting(false);
    }
  };
  if (loading || authLoading) return <CustomerLoading />;
  if (error)
    return (
      <CustomerShell>
        <main className="customer-content">
          <CustomerNotice message={error} />
        </main>
      </CustomerShell>
    );
  const content = (
    <>
      <main
        className="booking-layout customer-booking-layout"
        style={{
          "--business-accent": data.business.primary_color || "#718A68",
        }}
      >
        <section
          className="business-intro"
          style={
            data.business.cover_image_url
              ? {
                  backgroundImage: `linear-gradient(180deg, rgba(121,85,72,.14), #F5F0E6), url(${data.business.cover_image_url})`,
                  backgroundSize: "cover",
                  backgroundPosition: "center",
                }
              : undefined
          }
        >
          <div className="business-hero-logo">
            {data.business.logo_url ? (
              <img src={data.business.logo_url} alt="" />
            ) : (
              data.business.name[0]
            )}
          </div>
          <h1>{data.business.name}</h1>
          <p>{data.business.description}</p>
          <div className="business-facts">
            <span>
              ⌖ {data.business.address || "Διεύθυνση δεν έχει οριστεί"}
            </span>
            <span>☎ {data.business.phone || "Τηλέφωνο δεν έχει οριστεί"}</span>
            <span>
              ◷{" "}
              {data.hours
                .filter((hour) => !hour.is_closed && !hour.staff_id)
                .map(
                  (hour) =>
                    `${dayNames[hour.day_of_week]} ${hour.start_time.slice(0, 5)}–${hour.end_time.slice(0, 5)}`,
                )
                .join(" · ") || "Κατόπιν διαθεσιμότητας"}
            </span>
          </div>
          <button
            className="primary-button public-booking-cta"
            onClick={handleBookingClick}
          >
            Κλείσε ραντεβού <ChevronRight size={17} />
          </button>
          <div className="photo-strip">
            {(data.media.length
              ? data.media.slice(0, 3)
              : [{ url: "" }, { url: "" }, { url: "" }]
            ).map((photo, index) => (
              <div
                key={photo.id || index}
                style={
                  photo.url
                    ? {
                        backgroundImage: `url(${photo.url})`,
                        backgroundSize: "cover",
                        backgroundPosition: "center",
                      }
                    : undefined
                }
              />
            ))}
          </div>
        </section>
        <section className="booking-card">
          {success ? (
            <div className="success-state">
              <div className="success-icon">✓</div>
              <span className="eyebrow">ΕΠΙΒΕΒΑΙΩΣΗ</span>
              <h2>Το ραντεβού σας επιβεβαιώθηκε</h2>
              <p>
                <strong>{success.business}</strong>
                <br />
                {success.service} με {success.staff}
                <br />
                {success.date} στις {success.time} · {success.price}€
              </p>
              <Link className="outline-button" to="/my-appointments">
                Τα ραντεβού μου
              </Link>
            </div>
          ) : (
            <>
              <div className="booking-title">
                <span className="eyebrow">BOOK APPOINTMENT</span>
                <h2>Κλείστε την ώρα σας</h2>
                <p>Επιλέξτε υπηρεσία, επαγγελματία και διαθέσιμη ώρα.</p>
              </div>
              <label>
                Υπηρεσία
                <select
                  value={serviceId}
                  onChange={(event) => {
                    setServiceId(event.target.value);
                    setStaffId("any");
                    setTime("");
                  }}
                >
                  {data.services.map((item) => (
                    <option value={item.id} key={item.id}>
                      {item.name} · {item.price}€ · {item.duration_minutes}′
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Επαγγελματίας
                <select
                  value={staffId}
                  onChange={(event) => {
                    setStaffId(event.target.value);
                    setTime("");
                  }}
                >
                  <option value="any">Οποιοσδήποτε διαθέσιμος</option>
                  {eligibleStaff.map((person) => (
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
                  min={businessToday(data.timeZone)}
                  onChange={(event) => {
                    setDate(event.target.value);
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
                    <small>
                      Δεν υπάρχουν διαθέσιμες ώρες για αυτή την επιλογή.
                    </small>
                  )}
                </div>
              </div>
              <div className="customer-details">
                <span className="field-label">Τα στοιχεία σας</span>
                <input
                  placeholder="Ονοματεπώνυμο"
                  value={details.name}
                  autoComplete="name"
                  maxLength={120}
                  required
                  onChange={(event) =>
                    setDetails({ ...details, name: event.target.value })
                  }
                />
                <input
                  placeholder="Τηλέφωνο"
                  type="tel"
                  value={details.phone}
                  autoComplete="tel"
                  inputMode="tel"
                  maxLength={40}
                  required
                  onChange={(event) =>
                    setDetails({ ...details, phone: event.target.value })
                  }
                />
                <input
                  placeholder="Email"
                  type="email"
                  value={details.email}
                  autoComplete="email"
                  maxLength={254}
                  required
                  onChange={(event) =>
                    setDetails({ ...details, email: event.target.value })
                  }
                />
              </div>
              <CustomerNotice
                message={
                  !user
                    ? "Για να κλείσεις ραντεβού, συνδέσου ή δημιούργησε λογαριασμό."
                    : bookingError
                }
              />
              <div className="booking-summary">
                <span>
                  {service?.name || "Επιλέξτε υπηρεσία"}
                  <small>
                    {selectedStaff?.name || "Επιλέξτε προσωπικό"} ·{" "}
                    {service?.duration_minutes || 0} λεπτά
                  </small>
                </span>
                <strong>{service?.price || 0}€</strong>
              </div>
              {user ? (
                <button className="primary-button full" onClick={confirm} disabled={bookingSubmitting}>
                  {bookingSubmitting ? "Καταχώρηση..." : "Επιβεβαίωση ραντεβού"} <ChevronRight size={17} />
                </button>
              ) : (
                <div className="booking-auth-actions">
                  <Link
                    className="outline-button"
                    to={`/customer-login?returnTo=${encodeURIComponent(bookingPath)}`}
                  >
                    Σύνδεση
                  </Link>
                  <Link
                    className="primary-button"
                    to={`/customer-register?returnTo=${encodeURIComponent(bookingPath)}`}
                  >
                    Εγγραφή
                  </Link>
                </div>
              )}
            </>
          )}
        </section>
      </main>
    </>
  );

  return (
    <CustomerShell>
      {content}

      <button
        type="button"
        className="ai-chat-button"
        onClick={() => setChatOpen((open) => !open)}
        aria-label="Άνοιγμα εξυπηρέτησης πελατών"
      >
        <MessageCircle size={23} />
      </button>

      {chatOpen && (
        <div className="ai-chat-window">
          <div className="ai-chat-header">
            <strong>{chatMode === "ai" ? "Εξυπηρέτηση με AI" : "Εκπρόσωπος επιχείρησης"}</strong>
            <button type="button" aria-label="Κλείσιμο συνομιλίας" onClick={() => setChatOpen(false)}>
              ×
            </button>
          </div>

          <div className="support-mode-switch" role="group" aria-label="Επιλογή εξυπηρέτησης">
            <button type="button" aria-pressed={chatMode === "ai"} onClick={() => setChatMode("ai")}>
              🤖 Μίλησε με AI
            </button>
            <button type="button" aria-pressed={chatMode === "human"} onClick={() => setChatMode("human")}>
              👤 Μίλησε με εκπρόσωπο
            </button>
          </div>

          <div className="ai-chat-body" aria-live="polite">
            {chatMessages.map((item, index) => (
              <div
                key={`${item.sender_type}-${item.created_at || index}-${index}`}
                className={`ai-chat-message ${item.sender_type === "customer" ? "ai-chat-user" : "ai-chat-bot"}`}
              >
                <span>{item.body}</span>
                {item.offer_human && !supportSession && (
                  <button type="button" className="support-handoff-link" onClick={() => setChatMode("human")}>
                    Θέλεις να μιλήσεις με εκπρόσωπο;
                  </button>
                )}
              </div>
            ))}
            {chatLoading && <div className="ai-chat-message ai-chat-bot">Γράφω την απάντηση...</div>}
            {chatNotice && <p className="support-chat-notice" role="status">{chatNotice}</p>}
            {chatError && <p className="support-chat-error" role="alert">{chatError}</p>}
            {supportSession && (
              <p className="support-chat-status" role="status">
                Αίτημα: {supportSession.status === "completed" ? "Ολοκληρώθηκε" : supportSession.status === "in_progress" ? "Σε εξέλιξη" : "Νέο"}
              </p>
            )}
          </div>

          <form className="ai-chat-compose" onSubmit={sendChatMessage}>
            {chatMode === "human" && !supportSession && (
              <div className="support-contact-fields">
                <input
                  value={details.name}
                  onChange={(event) => setDetails({ ...details, name: event.target.value })}
                  placeholder="Ονοματεπώνυμο"
                  autoComplete="name"
                />
                <input
                  type="email"
                  value={details.email}
                  onChange={(event) => setDetails({ ...details, email: event.target.value })}
                  placeholder="Email (προαιρετικό αν δώσετε τηλέφωνο)"
                  autoComplete="email"
                />
                <input
                  type="tel"
                  value={details.phone}
                  onChange={(event) => setDetails({ ...details, phone: event.target.value })}
                  placeholder="Τηλέφωνο (προαιρετικό αν δώσετε email)"
                  autoComplete="tel"
                />
              </div>
            )}
            <div className="ai-chat-input">
              <input
                value={chatMessage}
                onChange={(event) => setChatMessage(event.target.value)}
                placeholder={chatMode === "ai" ? "Ρωτήστε για υπηρεσίες, ώρες ή διαθεσιμότητα..." : "Γράψτε το μήνυμά σας..."}
                maxLength={1500}
                disabled={chatLoading}
              />
              <button type="submit" aria-label="Αποστολή μηνύματος" disabled={chatLoading || !chatMessage.trim()}>
                {chatLoading ? "..." : <Send size={17} />}
              </button>
            </div>
          </form>
        </div>
      )}
    </CustomerShell>
  );
}

export function CustomerAppointmentsPage() {
  const { user, loading } = useCustomerAuth();
  const navigate = useNavigate();
  const [appointments, setAppointments] = useState([]);
  const [appointmentUpdateMessage, setAppointmentUpdateMessage] = useState("");
  const [error, setError] = useState("");
  const [loadingData, setLoadingData] = useState(true);
  const [canceling, setCanceling] = useState(null);
  const appointmentsRef = useRef([]);
  const customerCancelledIds = useRef(new Set());
  const load = async () => {
    if (!supabase || !isSupabaseConfigured) {
      setError(SUPABASE_CONFIG_ERROR);
      setLoadingData(false);
      return;
    }
    if (!user) {
      setLoadingData(false);
      return;
    }
    setLoadingData(true);
    try {
      const { data, error: requestError } = await supabase
        .from("appointments")
        .select(
          "*, business:businesses(name,slug,logo_url), service:services(name,price,duration_minutes), staff:staff(name)",
        )
        .eq("customer_id", user.id)
        .order("starts_at", { ascending: false });
      if (requestError) throw requestError;
      appointmentsRef.current = data || [];
      setAppointments(appointmentsRef.current);
      setError("");
    } catch (requestError) {
      reportCriticalError(requestError, {
        feature: "customer-appointments",
        operation: "load-appointments",
      });
      setAppointments([]);
      setError("Δεν ήταν δυνατή η φόρτωση των ραντεβού. Δοκιμάστε ξανά.");
    } finally {
      setLoadingData(false);
    }
  };
  useEffect(() => {
    if (loading) return undefined;
    if (!user) {
      navigate("/customer-login?returnTo=/my-appointments", { replace: true });
      return undefined;
    }
    load();
    if (!supabase) return undefined;
    const channel = supabase
      .channel(`customer-appointments-${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "appointments",
          filter: `customer_id=eq.${user.id}`,
        },
        ({ new: updated }) => {
          const previous = appointmentsRef.current.find((item) => item.id === updated.id);
          if (
            updated.status === "cancelled" &&
            previous?.status !== "cancelled" &&
            !customerCancelledIds.current.has(updated.id)
          ) {
            setAppointmentUpdateMessage("Η επιχείρηση ακύρωσε ή απέρριψε ένα από τα ραντεβού σας. Δείτε την ενότητα «Ακυρωμένα».");
          }
          load();
        },
      )
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [user, loading, navigate]);
  const cancel = async (id) => {
    if (!supabase || !user || canceling) return;
    setCanceling(id);
    setError("");
    customerCancelledIds.current.add(id);
    try {
      const { error: requestError } = await supabase
        .from("appointments")
        .update({ status: "cancelled" })
        .eq("id", id)
        .eq("customer_id", user.id);
      if (requestError) throw requestError;
      await load();
    } catch (requestError) {
      customerCancelledIds.current.delete(id);
      reportCriticalError(requestError, {
        feature: "customer-appointments",
        operation: "cancel-appointment",
      });
      setError("Δεν ήταν δυνατή η ακύρωση του ραντεβού. Δοκιμάστε ξανά.");
    } finally {
      setCanceling(null);
    }
  };
  const now = Date.now();
  const groups = {
    upcoming: appointments.filter(
      (item) =>
        new Date(item.starts_at).getTime() >= now &&
        item.status !== "cancelled",
    ),
    past: appointments.filter(
      (item) =>
        new Date(item.starts_at).getTime() < now && item.status !== "cancelled",
    ),
    cancelled: appointments.filter((item) => item.status === "cancelled"),
  };
  const content = (
    <>
      <main className="customer-content">
        <div className="customer-page-heading">
          <span className="eyebrow">ΠΕΛΑΤΗΣ</span>
          <h1>Τα ραντεβού μου</h1>
          <p>Όλες οι επόμενες, παλιές και ακυρωμένες κρατήσεις σας.</p>
        </div>
        {appointmentUpdateMessage && (
          <div className="notice success" role="status">{appointmentUpdateMessage}</div>
        )}
        <CustomerNotice message={error} />
        {loading || loadingData ? (
          <CustomerLoading />
        ) : (
          <div className="customer-appointments-groups">
            {Object.entries(groups).map(([key, items]) => (
              <section key={key}>
                <h2>
                  {key === "upcoming"
                    ? "Επόμενα"
                    : key === "past"
                      ? "Παλαιότερα"
                      : "Ακυρωμένα"}
                </h2>
                {items.length ? (
                  items.map((appointment) => (
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
                        <strong>
                          {appointment.business?.name || "Επιχείρηση"}
                        </strong>
                        <span>
                          {appointment.service?.name || "Υπηρεσία"} ·{" "}
                          {appointment.staff?.name || "Προσωπικό"}
                        </span>
                        <small>
                          {new Date(appointment.starts_at).toLocaleString(
                            "el-GR",
                          )}{" "}
                          · {appointment.status === "cancelled"
                            ? "Ακυρωμένο"
                            : appointment.status === "confirmed"
                              ? "Επιβεβαιωμένο"
                              : appointment.status === "booked" || appointment.status === "pending"
                                ? "Σε αναμονή"
                                : "Ολοκληρωμένο"}
                        </small>
                      </div>
                      {key === "upcoming" && (
                        <button
                          className="outline-button"
                          disabled={canceling === appointment.id}
                          onClick={() => cancel(appointment.id)}
                        >
                          {canceling === appointment.id ? "Ακύρωση..." : "Ακύρωση"}
                        </button>
                      )}
                    </div>
                  ))
                ) : (
                  <div className="empty-state">
                    Δεν υπάρχουν ραντεβού σε αυτή την κατηγορία.
                  </div>
                )}
              </section>
            ))}
          </div>
        )}
      </main>
    </>
  );

  return <CustomerShell>{content}</CustomerShell>;
}

export function CustomerProfile() {
  const { user, loading } = useCustomerAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ full_name: "", phone: "", email: "" });
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!user) return;
    let active = true;
    async function loadProfile() {
      try {
        const { data, error } = await supabase
          .from("customer_profiles")
          .select("full_name,phone,email")
          .eq("user_id", user.id)
          .is("business_id", null)
          .maybeSingle();
        if (error) throw error;
        if (active) {
          setForm({
            full_name: data?.full_name || user.user_metadata?.full_name || "",
            phone: data?.phone || user.user_metadata?.phone || "",
            email: data?.email || user.email || "",
          });
        }
      } catch (requestError) {
        reportCriticalError(requestError, {
          feature: "customer-profile",
          operation: "load-profile",
        });
        if (active) setMessage("Δεν ήταν δυνατή η φόρτωση του προφίλ. Δοκιμάστε ξανά.");
      }
    }
    loadProfile();
    return () => {
      active = false;
    };
  }, [user]);
  useEffect(() => {
    if (!loading && !user)
      navigate("/customer-login?returnTo=/customer/profile", {
        replace: true,
      });
  }, [loading, user, navigate]);
  const save = async (event) => {
    event.preventDefault();
    if (saving) return;
    if (!supabase || !isSupabaseConfigured) {
      setMessage(SUPABASE_CONFIG_ERROR);
      return;
    }
    if (!user) return;
    setSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({
        data: { full_name: form.full_name, phone: form.phone },
      });
      if (error) throw error;
      const { data: existing, error: profileLookupError } = await supabase
        .from("customer_profiles")
        .select("id")
        .eq("user_id", user.id)
        .is("business_id", null)
        .maybeSingle();
      if (profileLookupError) throw profileLookupError;
      const profileRequest = existing
        ? supabase
            .from("customer_profiles")
            .update({
              full_name: form.full_name,
              phone: form.phone,
              email: form.email,
            })
            .eq("id", existing.id)
        : supabase.from("customer_profiles").insert({
            user_id: user.id,
            full_name: form.full_name,
            phone: form.phone,
            email: form.email,
          });
      const { error: profileError } = await profileRequest;
      if (profileError) throw profileError;
      setMessage("Το προφίλ σας ενημερώθηκε.");
    } catch (requestError) {
      reportCriticalError(requestError, {
        feature: "customer-profile",
        operation: "save-profile",
      });
      setMessage("Δεν ήταν δυνατή η αποθήκευση του προφίλ. Δοκιμάστε ξανά.");
    } finally {
      setSaving(false);
    }
  };
  if (loading) return <CustomerLoading />;
  const content = (
    <>
      <main className="customer-content">
        <div className="customer-page-heading">
          <span className="eyebrow">ΛΟΓΑΡΙΑΣΜΟΣ</span>
          <h1>Το προφίλ μου</h1>
          <p>Διαχειριστείτε τα στοιχεία επικοινωνίας σας.</p>
        </div>
        <section className="panel customer-profile-panel">
          <CustomerNotice
            message={message}
            success={message.includes("ενημερώθηκε")}
          />
          <form className="customer-profile-form" onSubmit={save}>
            <label>
              Ονοματεπώνυμο
              <input
                value={form.full_name}
                onChange={(event) =>
                  setForm({ ...form, full_name: event.target.value })
                }
                required
              />
            </label>
            <label>
              Τηλέφωνο
              <input
                type="tel"
                value={form.phone}
                onChange={(event) =>
                  setForm({ ...form, phone: event.target.value })
                }
              />
            </label>
            <label>
              Email
              <input type="email" value={form.email} disabled />
            </label>
            <button className="primary-button" disabled={saving}>
              {saving ? "Αποθήκευση..." : "Αποθήκευση"}
            </button>
          </form>
          <button
            className="outline-button"
            onClick={async () => {
              await supabase?.auth.signOut();
              window.location.href = "/customer";
            }}
          >
            <LogOut size={15} /> Αποσύνδεση
          </button>
        </section>
      </main>
    </>
  );

  return <CustomerShell>{content}</CustomerShell>;
}

export function CustomerSupportPage() {
  return (
    <CustomerShell>
      <main className="customer-section-page">
        <section className="customer-section-card ai-support-card">
          <div className="customer-section-icon"><MessageCircle size={24} /></div>
          <h1>Εξυπηρέτηση επιχείρησης</h1>
          <p>
            Για απάντηση σχετικά με υπηρεσίες, διαθεσιμότητα ή το ραντεβού σας,
            ανοίξτε τη σελίδα της επιχείρησης. Εκεί μπορείτε να μιλήσετε με AI ή
            να στείλετε αίτημα σε εκπρόσωπο χωρίς να δημιουργήσετε λογαριασμό.
          </p>
          <Link className="primary-button" to="/customer">
            <Search size={16} /> Βρείτε επιχείρηση
          </Link>
        </section>
      </main>
    </CustomerShell>
  );
}
