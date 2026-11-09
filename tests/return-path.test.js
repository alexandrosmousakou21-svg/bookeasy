import test from "node:test";
import assert from "node:assert/strict";
import { safeReturnPath } from "../src/lib/returnPath.js";

test("accepts and normalizes internal return paths", () => {
  assert.equal(safeReturnPath("/b/studio?date=2026-11-08#booking"), "/b/studio?date=2026-11-08#booking");
  assert.equal(safeReturnPath("/customer/../my-appointments"), "/my-appointments");
});

test("rejects external, ambiguous and control-character paths", () => {
  for (const value of ["https://evil.example", "//evil.example", "/\\evil.example", "/%2f%2fevil.example", "/%5cevil.example", "/\nevil.example", "/%0aevil.example", "javascript:alert(1)", ""]) {
    assert.equal(safeReturnPath(value), "/customer", value);
  }
  assert.equal(safeReturnPath("//evil.example", null), null);
});