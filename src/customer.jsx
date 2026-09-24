import { useEffect, useMemo, useState } from "react";
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
  Search,
  UserRound,
  X,
} from "lucide-react";
import {
  supabase,
  isSupabaseConfigured,
  SUPABASE_CONFIG_ERROR,
} from "./lib/supabase";

const errorText = (error) =>
  error?.code === "23P01"
    ? "Η ώρα έχει ήδη κρατηθεί. Επιλέξτε άλλη διαθέσιμη ώρα."
    : error?.message || "Παρουσιάστηκε σφάλμα. Δοκιμάστε ξανά.";
const safeReturnPath = (value, fallback = "/customer") => {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return fallback;
  return value;
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

function useCustomerAuth() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(isSupabaseConfigured);
  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return undefined;
    }
    let active = true;
    supabase.auth.getUser().then(({ data }) => {
      if (active) {
        setUser(data.user);
        setLoading(false);
      }
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
    async function load() {
      if (!supabase || !isSupabaseConfigured) {
        setError(SUPABASE_CONFIG_ERROR);
        setLoading(false);
        return;
      }
      const { data, error: requestError } = await supabase
        .from("businesses")
        .select(
          "id,name,slug,description,address,city,category,phone,logo_url,cover_image_url,subscription_plan",
        )
        .eq("subscription_plan", "plus")
        .order("name");
      setBusinesses(data || []);
      setError(requestError ? errorText(requestError) : "");
      setLoading(false);
    }
    load();
  }, []);
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = normalizedQuery
    ? businesses.filter((business) =>
        `${business.name} ${business.description || ""} ${business.address || ""} ${business.city || ""} ${business.category || ""}`
          .toLowerCase()
          .includes(normalizedQuery),
      )
    : businesses;
  return (
    <CustomerShell>
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
    </CustomerShell>
  );
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
      setLoading(false);
      return;
    }
    if (mode === "register" && !result.data.session) {
      setError(
        "Ελέγξτε το email σας για επιβεβαίωση και μετά συνδεθείτε για να συνεχίσετε.",
      );
      setLoading(false);
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
        setError(errorText(profileError));
        setLoading(false);
        return;
      }
    }
    navigate(returnTo);
    setLoading(false);
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
  return {
    business,
    services: serviceResult.data || [],
    staff: staffResult.data || [],
    hours: hoursResult.data || [],
    media: mediaResult.data || [],
    assignments: assignmentResult.data || [],
  };
}
function getSlots(date, service, staffMember, hours, appointments) {
  if (!service || !staffMember) return [];
  const day = new Date(`${date}T12:00:00`).getDay();
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
    const start = new Date(
      `${date}T${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}:00`,
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
        `${String(start.getHours()).padStart(2, "0")}:${String(start.getMinutes()).padStart(2, "0")}`,
      );
  }
  return slots;
}

export function CustomerBooking() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useCustomerAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [staffId, setStaffId] = useState("any");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [time, setTime] = useState("");
  const [appointments, setAppointments] = useState([]);
  const [details, setDetails] = useState({ name: "", phone: "", email: "" });
  const [bookingError, setBookingError] = useState("");
  const [success, setSuccess] = useState(null);
  const bookingPath = `/b/${encodeURIComponent(slug)}`;
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
    loadBusinessData(slug)
      .then((result) => {
        setData(result);
        setServiceId(result.services[0]?.id || "");
        setLoading(false);
      })
      .catch((requestError) => {
        setError(requestError.message);
        setLoading(false);
      });
  }, [slug]);
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
    async function loadAppointments() {
      if (!data?.business?.id || !selectedStaff) return;
      const { data: rows, error: requestError } = await supabase.rpc(
        "get_booked_intervals",
        {
          target_business: data.business.id,
          target_staff: selectedStaff.id,
          target_date: date,
        },
      );
      if (requestError) {
        setBookingError(errorText(requestError));
        setAppointments([]);
        return;
      }
      setAppointments(rows || []);
    }
    loadAppointments();
  }, [data?.business?.id, date, selectedStaff?.id]);
  const slots = useMemo(
    () =>
      getSlots(date, service, selectedStaff, data?.hours || [], appointments),
    [date, service, selectedStaff, data?.hours, appointments],
  );
  const confirm = async () => {
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
      !details.name ||
      !details.phone ||
      !details.email
    ) {
      setBookingError(
        "Συμπληρώστε τα στοιχεία σας και επιλέξτε διαθέσιμη ώρα.",
      );
      return;
    }
    const starts = new Date(`${date}T${time}:00`);
    const ends = new Date(starts.getTime() + service.duration_minutes * 60000);
    const { error: profileError } = await supabase
      .from("customer_profiles")
      .upsert(
        {
          user_id: user.id,
          full_name: details.name,
          phone: details.phone,
          email: details.email,
          business_id: data.business.id,
        },
        { onConflict: "user_id,business_id" },
      );
    if (profileError) {
      setBookingError(errorText(profileError));
      return;
    }
    const { data: createdAppointment, error: insertError } = await supabase
      .from("appointments")
      .insert({
        business_id: data.business.id,
        customer_id: user.id,
        staff_id: selectedStaff.id,
        service_id: service.id,
        appointment_date: date,
        start_time: time,
        end_time: `${String(ends.getHours()).padStart(2, "0")}:${String(ends.getMinutes()).padStart(2, "0")}:00`,
        status: "booked",
        customer_name: details.name,
        customer_phone: details.phone,
        customer_email: details.email,
        starts_at: starts.toISOString(),
        ends_at: ends.toISOString(),
      })
      .select(
        "id,business_id,customer_id,staff_id,service_id,appointment_date,start_time,end_time,status,customer_name,customer_phone,customer_email",
      )
      .single();
    if (insertError) {
      setBookingError(errorText(insertError));
      return;
    }
    const { error: refreshError } = await supabase
      .from("appointments")
      .select(
        "id,business_id,service_id,staff_id,appointment_date,start_time,end_time,status",
      )
      .eq("customer_id", user.id)
      .order("appointment_date", { ascending: false });
    if (refreshError) {
      setBookingError(errorText(refreshError));
      return;
    }
    setSuccess({
      appointmentId: createdAppointment.id,
      business: data.business.name,
      service: service.name,
      staff: selectedStaff.name,
      date,
      time,
      price: service.price,
    });
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
  return (
    <CustomerShell>
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
                  min={new Date().toISOString().slice(0, 10)}
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
                  onChange={(event) =>
                    setDetails({ ...details, name: event.target.value })
                  }
                />
                <input
                  placeholder="Τηλέφωνο"
                  type="tel"
                  value={details.phone}
                  onChange={(event) =>
                    setDetails({ ...details, phone: event.target.value })
                  }
                />
                <input
                  placeholder="Email"
                  type="email"
                  value={details.email}
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
                <button className="primary-button full" onClick={confirm}>
                  Επιβεβαίωση ραντεβού <ChevronRight size={17} />
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
    </CustomerShell>
  );
}

export function CustomerAppointmentsPage() {
  const { user, loading } = useCustomerAuth();
  const navigate = useNavigate();
  const [appointments, setAppointments] = useState([]);
  const [error, setError] = useState("");
  const [loadingData, setLoadingData] = useState(true);
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
    const { data, error: requestError } = await supabase
      .from("appointments")
      .select(
        "*, business:businesses(name,slug,logo_url), service:services(name,price,duration_minutes), staff:staff(name)",
      )
      .eq("customer_id", user.id)
      .order("starts_at", { ascending: false });
    setAppointments(data || []);
    setError(requestError ? errorText(requestError) : "");
    setLoadingData(false);
  };
  useEffect(() => {
    if (!loading && !user) {
      navigate("/customer-login?returnTo=/my-appointments", { replace: true });
      return;
    }
    if (!loading) load();
  }, [user, loading, navigate]);
  const cancel = async (id) => {
    const { error: requestError } = await supabase
      .from("appointments")
      .update({ status: "cancelled" })
      .eq("id", id)
      .eq("customer_id", user.id);
    if (requestError) setError(errorText(requestError));
    else load();
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
  return (
    <CustomerShell>
      <main className="customer-content">
        <div className="customer-page-heading">
          <span className="eyebrow">ΠΕΛΑΤΗΣ</span>
          <h1>Τα ραντεβού μου</h1>
          <p>Όλες οι επόμενες, παλιές και ακυρωμένες κρατήσεις σας.</p>
        </div>
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
                          · {appointment.status}
                        </small>
                      </div>
                      {key === "upcoming" && (
                        <button
                          className="outline-button"
                          onClick={() => cancel(appointment.id)}
                        >
                          Ακύρωση
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
    </CustomerShell>
  );
}

export function CustomerProfile() {
  const { user, loading } = useCustomerAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ full_name: "", phone: "", email: "" });
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (!user) return;
    async function loadProfile() {
      const { data, error } = await supabase
        .from("customer_profiles")
        .select("full_name,phone,email")
        .eq("user_id", user.id)
        .is("business_id", null)
        .maybeSingle();
      if (error) {
        setMessage(errorText(error));
        return;
      }
      setForm({
        full_name: data?.full_name || user.user_metadata?.full_name || "",
        phone: data?.phone || user.user_metadata?.phone || "",
        email: data?.email || user.email || "",
      });
    }
    loadProfile();
  }, [user]);
  useEffect(() => {
    if (!loading && !user)
      navigate("/customer-login?returnTo=/customer/profile", {
        replace: true,
      });
  }, [loading, user, navigate]);
  const save = async (event) => {
    event.preventDefault();
    if (!supabase || !isSupabaseConfigured) {
      setMessage(SUPABASE_CONFIG_ERROR);
      return;
    }
    if (!user) return;
    const { error } = await supabase.auth.updateUser({
      data: { full_name: form.full_name, phone: form.phone },
    });
    if (error) {
      setMessage(errorText(error));
      return;
    }
    const { data: existing, error: profileLookupError } = await supabase
      .from("customer_profiles")
      .select("id")
      .eq("user_id", user.id)
      .is("business_id", null)
      .maybeSingle();
    if (profileLookupError) {
      setMessage(errorText(profileLookupError));
      return;
    }
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
    if (profileError) setMessage(errorText(profileError));
    else setMessage("Το προφίλ σας ενημερώθηκε.");
  };
  if (loading) return <CustomerLoading />;
  return (
    <CustomerShell>
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
            <button className="primary-button">Αποθήκευση</button>
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
    </CustomerShell>
  );
}
