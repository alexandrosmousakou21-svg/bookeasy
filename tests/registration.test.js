import assert from "node:assert/strict";
import test from "node:test";
import {
  ensureCustomerProfile,
  ensureProfessionalBusiness,
  registrationAuthError,
  validateRegistration,
} from "../src/lib/registration.js";

function createSupabaseMock({ businesses = [], profiles = [], insertError = null } = {}) {
  const rows = { businesses: [...businesses], customer_profiles: [...profiles] };
  let nextId = 1;

  return {
    rows,
    from(table) {
      const query = { table, filters: {}, values: null, operation: "select" };
      query.select = () => query;
      query.eq = (column, value) => {
        query.filters[column] = value;
        return query;
      };
      query.is = (column, value) => {
        query.filters[column] = value;
        return query;
      };
      query.limit = () => query;
      query.maybeSingle = async () => {
        if (query.operation === "insert") {
          if (insertError) return { data: null, error: insertError };
          const row = { id: `row-${nextId++}`, ...query.values };
          rows[table].push(row);
          return { data: row, error: null };
        }
        return {
          data: rows[table].find((row) =>
            Object.entries(query.filters).every(([column, value]) => row[column] === value)
          ) || null,
          error: null,
        };
      };
      query.insert = (values) => {
        query.operation = "insert";
        query.values = values;
        return query;
      };
      return query;
    },
  };
}

test("registration validates email, password, account details and confirmation", () => {
  assert.match(validateRegistration({ accountType: "customer", email: "bad", password: "123456", fullName: "Alex", phone: "12345", confirmPassword: "123456" }), /email/i);
  assert.match(validateRegistration({ accountType: "professional", email: "pro@example.com", password: "123", businessName: "Studio" }), /κωδικός/);
  assert.match(validateRegistration({ accountType: "professional", email: "pro@example.com", password: "123456", businessName: " " }), /επιχείρησης/);
  assert.match(validateRegistration({ accountType: "customer", email: "customer@example.com", password: "123456", fullName: "Alex", phone: "12345", confirmPassword: "654321" }), /δεν ταιριάζουν/);
  assert.equal(validateRegistration({ accountType: "customer", email: "customer@example.com", password: "123456", fullName: "Alex Doe", phone: "+306900000000", confirmPassword: "123456" }), "");
});

test("duplicate email errors receive clear Greek guidance", () => {
  assert.match(registrationAuthError({ code: "user_already_exists" }), /Υπάρχει ήδη λογαριασμός/);
  assert.equal(registrationAuthError({ code: "invalid_credentials" }), "");
});

test("confirmed customer login provisions a profile once from auth metadata", async () => {
  const supabase = createSupabaseMock();
  const user = {
    id: "customer-1",
    email: "customer@example.com",
    user_metadata: { full_name: "Alex Doe", phone: "+306900000000", account_type: "customer" },
  };

  await ensureCustomerProfile(supabase, user);
  await ensureCustomerProfile(supabase, user);

  assert.equal(supabase.rows.customer_profiles.length, 1);
  assert.equal(supabase.rows.customer_profiles[0].full_name, "Alex Doe");
  assert.equal(supabase.rows.customer_profiles[0].business_id, null);
});

test("customer profile write failures are surfaced for retry", async () => {
  const supabase = createSupabaseMock({ insertError: { code: "42501", message: "denied" } });
  const user = { id: "customer-1", user_metadata: { full_name: "Alex Doe" } };

  await assert.rejects(ensureCustomerProfile(supabase, user), { code: "42501" });
});

test("professional login provisions a workspace after email confirmation and resolves slug collisions", async () => {
  const supabase = createSupabaseMock({ businesses: [{ id: "existing", owner_id: "other-user", slug: "studio" }] });
  const user = { id: "professional-1", user_metadata: { business_name: "Studio" } };

  const business = await ensureProfessionalBusiness(supabase, user, () => "studio");

  assert.equal(business.slug, "studio-2");
  assert.equal(supabase.rows.businesses.length, 2);
  assert.equal(supabase.rows.businesses[1].owner_id, user.id);
});

test("professional workspace creation is idempotent after a successful registration", async () => {
  const supabase = createSupabaseMock();
  const user = { id: "professional-1", user_metadata: { business_name: "Studio" } };

  await ensureProfessionalBusiness(supabase, user, () => "studio");
  await ensureProfessionalBusiness(supabase, user, () => "studio");

  assert.equal(supabase.rows.businesses.length, 1);
});