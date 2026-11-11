import assert from "node:assert/strict";
import test from "node:test";
import { supabaseErrorMessage } from "../src/lib/errorMessages.js";

test("Supabase permission, session, network, timeout, validation and server errors are distinct", () => {
  assert.match(supabaseErrorMessage({ code: "42501" }), /δικαίωμα/);
  assert.match(supabaseErrorMessage({ status: 401 }), /έληξε/);
  assert.match(supabaseErrorMessage({ name: "TypeError", message: "Failed to fetch" }), /επικοινωνία/);
  assert.match(supabaseErrorMessage({ status: 408 }), /άργησε/);
  assert.match(supabaseErrorMessage({ code: "22023" }), /δεν είναι έγκυρα/);
  assert.match(supabaseErrorMessage({ status: 503 }), /προσωρινό πρόβλημα/);
});

test("missing atomic-save RPC identifies the required database update", () => {
  assert.match(supabaseErrorMessage({ code: "PGRST202" }), /ενημέρωση της βάσης/);
});

test("booking conflict and availability codes preserve actionable feedback", () => {
  assert.match(supabaseErrorMessage({ code: "23P01" }), /ήδη κρατηθεί/);
  assert.match(supabaseErrorMessage({ code: "BK002" }), /εκτός ωραρίου/);
  assert.match(supabaseErrorMessage({ code: "BK004" }), /έχει περάσει/);
  assert.match(supabaseErrorMessage({ code: "BK005" }), /δεν μπορεί να αλλάξει/);
  assert.match(supabaseErrorMessage({ code: "BK006" }), /διάλειμμα ή ημέρα αργίας/);
});