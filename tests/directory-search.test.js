import assert from "node:assert/strict";
import test from "node:test";
import { matchesBusinessQuery, normalizeDirectoryText } from "../src/lib/directorySearch.js";

const barber = { name: "Κουρείο Νίκος", category: "Barber", city: "Αθήνα" };
const nail = { name: "Nail Studio", category: "Μανικιούρ", city: "Θεσσαλονίκη" };

test("directory matching is accent-insensitive and supports Greek/English category synonyms", () => {
  assert.equal(normalizeDirectoryText("Κομμωτήρια Αθήνας"), "κομμωτηρια αθηνασ");
  assert.equal(matchesBusinessQuery(barber, "barber"), true);
  assert.equal(matchesBusinessQuery(barber, "κουρεία"), true);
  assert.equal(matchesBusinessQuery(nail, "nail salon"), true);
  assert.equal(matchesBusinessQuery(nail, "μανικιουρ"), true);
});

test("directory search combines category and location without matching unrelated regions", () => {
  assert.equal(matchesBusinessQuery(barber, "barber αθηνα"), true);
  assert.equal(matchesBusinessQuery(barber, "barber θεσσαλονικη"), false);
  assert.equal(matchesBusinessQuery(nail, "Nail Studio θεσσαλονικη"), true);
});

test("directory search includes real active service names", () => {
  assert.equal(matchesBusinessQuery({ ...barber, service_names: ["Ανδρικό κούρεμα"] }, "ανδρικό κούρεμα"), true);
  assert.equal(matchesBusinessQuery({ ...nail, service_names: ["Gel manicure"] }, "gel manicure"), true);
  assert.equal(matchesBusinessQuery({ ...barber, service_names: ["Ανδρικό κούρεμα"] }, "pedicure"), false);
});