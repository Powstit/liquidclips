import assert from "node:assert/strict";
import test from "node:test";

import {
  AGENCY_JWT_COOKIE_NAME,
  AGENCY_JWT_OWNER_COOKIE_NAME,
  createAgencyJwtOwnerBinding,
  readBoundAgencyLicenseJwt,
  storeBoundAgencyLicenseJwt,
  verifyAgencyJwtOwnerBinding,
} from "../src/lib/agency-license-cache.ts";

const SECRET = "test-only-secret-at-least-sixteen-characters";

function fakeJar(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    get(name) {
      const value = values.get(name);
      return value === undefined ? undefined : { value };
    },
    set(options) {
      values.set(options.name, options.value);
    },
    delete(name) {
      values.delete(name);
    },
  };
}

test("reuses a cached JWT only for the Clerk user that minted it", () => {
  const jar = fakeJar();
  storeBoundAgencyLicenseJwt(jar, "user_a", "jwt-for-a", SECRET);
  assert.equal(readBoundAgencyLicenseJwt(jar, "user_a", SECRET), "jwt-for-a");
});

test("A to B account switch clears A's JWT instead of reusing it", () => {
  const jar = fakeJar();
  storeBoundAgencyLicenseJwt(jar, "user_a", "jwt-for-a", SECRET);

  assert.equal(readBoundAgencyLicenseJwt(jar, "user_b", SECRET), null);
  assert.equal(jar.values.has(AGENCY_JWT_COOKIE_NAME), false);
  assert.equal(jar.values.has(AGENCY_JWT_OWNER_COOKIE_NAME), false);
});

test("tampered owner binding is rejected and cleared", () => {
  const jar = fakeJar({
    [AGENCY_JWT_COOKIE_NAME]: "jwt-for-a",
    [AGENCY_JWT_OWNER_COOKIE_NAME]: `${createAgencyJwtOwnerBinding(
      "user_a",
      SECRET,
    )}tampered`,
  });
  assert.equal(readBoundAgencyLicenseJwt(jar, "user_a", SECRET), null);
  assert.equal(jar.values.size, 0);
});

test("legacy unbound JWT is rejected and cleared", () => {
  const jar = fakeJar({ [AGENCY_JWT_COOKIE_NAME]: "legacy-jwt" });
  assert.equal(readBoundAgencyLicenseJwt(jar, "user_a", SECRET), null);
  assert.equal(jar.values.size, 0);
});

test("binding signature cannot be replayed for another Clerk user", () => {
  const binding = createAgencyJwtOwnerBinding("user_a", SECRET);
  assert.equal(verifyAgencyJwtOwnerBinding(binding, "user_a", SECRET), true);
  assert.equal(verifyAgencyJwtOwnerBinding(binding, "user_b", SECRET), false);
  assert.equal(
    verifyAgencyJwtOwnerBinding(binding, "user_a", `${SECRET}-wrong`),
    false,
  );
});

test("missing server secret disables persistent cache reuse", () => {
  const jar = fakeJar();
  storeBoundAgencyLicenseJwt(jar, "user_a", "jwt-for-a", null);
  assert.equal(jar.values.size, 0);
});
