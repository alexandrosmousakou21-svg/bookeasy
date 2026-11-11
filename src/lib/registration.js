export function validateRegistration({
  accountType,
  email,
  password,
  businessName,
  fullName,
  phone,
  confirmPassword,
}) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim())) {
    return "Εισαγάγετε μια έγκυρη διεύθυνση email.";
  }
  if (typeof password !== "string" || password.length < 6) {
    return "Ο κωδικός πρέπει να περιέχει τουλάχιστον 6 χαρακτήρες.";
  }
  if (confirmPassword !== undefined && password !== confirmPassword) {
    return "Οι κωδικοί πρόσβασης δεν ταιριάζουν.";
  }
  if (accountType === "professional" && String(businessName || "").trim().length < 2) {
    return "Το όνομα της επιχείρησης πρέπει να περιέχει τουλάχιστον 2 χαρακτήρες.";
  }
  if (accountType === "customer") {
    if (String(fullName || "").trim().length < 2) {
      return "Το ονοματεπώνυμο πρέπει να περιέχει τουλάχιστον 2 χαρακτήρες.";
    }
    if (String(phone || "").trim().length < 5) {
      return "Εισαγάγετε έναν έγκυρο αριθμό τηλεφώνου.";
    }
  }
  return "";
}

export function registrationAuthError(error) {
  const message = String(error?.message || "");
  if (
    ["user_already_exists", "email_exists"].includes(error?.code) ||
    /already (?:registered|exists)|email.*already/i.test(message)
  ) {
    return "Υπάρχει ήδη λογαριασμός με αυτό το email. Συνδεθείτε ή ανακτήστε τον κωδικό σας.";
  }
  return "";
}

async function findProfile(supabase, userId) {
  return supabase
    .from("customer_profiles")
    .select("id")
    .eq("user_id", userId)
    .is("business_id", null)
    .limit(1)
    .maybeSingle();
}

export async function ensureCustomerProfile(supabase, user) {
  if (!user?.id) throw new Error("authenticated_user_required");
  const { data: existing, error: lookupError } = await findProfile(supabase, user.id);
  if (lookupError) throw lookupError;
  if (existing) return existing;

  const fullName = String(user.user_metadata?.full_name || "").trim();
  if (!fullName) return null;
  const { data, error } = await supabase
    .from("customer_profiles")
    .insert({
      user_id: user.id,
      business_id: null,
      full_name: fullName,
      email: user.email || null,
      phone: String(user.user_metadata?.phone || "").trim() || null,
    })
    .select("id")
    .maybeSingle();
  if (!error) return data;
  if (error.code === "23505") {
    const { data: concurrent, error: retryError } = await findProfile(supabase, user.id);
    if (!retryError && concurrent) return concurrent;
  }
  throw error;
}

async function findOwnedBusiness(supabase, userId) {
  return supabase
    .from("businesses")
    .select("id,slug")
    .eq("owner_id", userId)
    .limit(1)
    .maybeSingle();
}

export async function ensureProfessionalBusiness(supabase, user, slugify) {
  if (!user?.id) throw new Error("authenticated_user_required");
  const { data: owned, error: ownerLookupError } = await findOwnedBusiness(supabase, user.id);
  if (ownerLookupError) throw ownerLookupError;
  if (owned) return owned;

  const name = String(user.user_metadata?.business_name || "").trim();
  if (name.length < 2) return null;
  const baseSlug = slugify(name);

  for (let suffix = 1; suffix <= 50; suffix += 1) {
    const slug = suffix === 1 ? baseSlug : `${baseSlug}-${suffix}`;
    const { data: slugOwner, error: slugLookupError } = await supabase
      .from("businesses")
      .select("id")
      .eq("slug", slug)
      .maybeSingle();
    if (slugLookupError) throw slugLookupError;
    if (slugOwner) continue;

    const { data, error } = await supabase
      .from("businesses")
      .insert({
        owner_id: user.id,
        name,
        slug,
        description: "",
        address: "",
        phone: "",
      })
      .select("id,slug")
      .maybeSingle();
    if (!error) return data || { slug };
    if (error.code !== "23505") throw error;

    const { data: concurrent, error: retryError } = await findOwnedBusiness(supabase, user.id);
    if (retryError) throw retryError;
    if (concurrent) return concurrent;
  }
  throw new Error("business_slug_allocation_failed");
}