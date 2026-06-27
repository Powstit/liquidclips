import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");

test("IG-014: boot and status checks use the safe presence mirror", () => {
  const app = fs.readFileSync(path.join(ROOT, "src/App.tsx"), "utf8");
  const authStorage = fs.readFileSync(path.join(ROOT, "src/lib/authStorage.ts"), "utf8");
  const settings = fs.readFileSync(path.join(ROOT, "src/design-os/routes/Settings.tsx"), "utf8");
  const rust = fs.readFileSync(path.join(ROOT, "src-tauri/src/lib.rs"), "utf8");

  expect(app).toContain("if (!hasJwt() && await hasJwtKeychainPresence())");
  expect(authStorage).toContain('invoke<Record<string, boolean>>("secret_presence_get")');
  expect(settings).toContain('invoke<Record<string, boolean>>("secret_presence_get")');
  expect(rust).toContain("write_secret_presence(KEYCHAIN_ACCOUNT, true)");
  expect(rust).toContain("write_secret_presence(OPENAI_KEYCHAIN_ACCOUNT, true)");
});
