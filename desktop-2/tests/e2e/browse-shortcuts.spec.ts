import { expect, test, type Page } from "@playwright/test";

import { installBackendStubs } from "./fixtures/backendFixtures";

async function boot(page: Page, shortcuts: unknown[] = []): Promise<void> {
  await installBackendStubs(page, { tier: "agency" });
  await page.addInitScript((seedShortcuts) => {
    window.localStorage.setItem("lc.license.jwt.v1", "browse.harness.jwt");
    window.localStorage.setItem(
      "lc.onboarding.agency-welcome.seen.v1",
      "1",
    );
    window.localStorage.setItem(
      "lc.scheduler.shortcuts.v1",
      JSON.stringify(seedShortcuts),
    );
  }, shortcuts);
  await page.goto("/?skipIntro=1#/home", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".lc-app")).toBeVisible({ timeout: 40_000 });
  await page
    .getByRole("button", { name: "Open in-app browser", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Browser overlay" }),
  ).toBeVisible();
}

test("shortcut form validates, persists, navigates, cancels, and respects Escape", async ({
  page,
}) => {
  await boot(page);
  const browser = page.getByRole("dialog", { name: "Browser overlay" });

  await browser.getByRole("button", { name: "Add shortcut" }).click();
  const form = page.getByRole("dialog", { name: "Add shortcut" });
  await expect(form).toBeVisible();
  await expect(form.getByRole("textbox", { name: "Shortcut name" })).toBeFocused();

  await form.getByRole("button", { name: "Add shortcut" }).click();
  await expect(form.getByRole("alert")).toHaveText("Name can't be empty.");

  await form.getByRole("textbox", { name: "Shortcut name" }).fill("LinkedIn");
  await form.getByRole("textbox", { name: "Shortcut URL" }).fill("ftp://invalid");
  await form.getByRole("button", { name: "Add shortcut" }).click();
  await expect(form.getByRole("alert")).toHaveText(
    "URL must start with http:// or https://",
  );

  await form
    .getByRole("textbox", { name: "Shortcut URL" })
    .fill("https://www.linkedin.com/feed/");
  await form.getByRole("button", { name: "Add shortcut" }).click();
  await expect(form).toBeHidden();
  const linkedIn = browser.getByRole("button", { name: "Open LinkedIn" });
  await expect(linkedIn).toBeVisible();

  const persisted = await page.evaluate(() =>
    JSON.parse(
      window.localStorage.getItem("lc.scheduler.shortcuts.v1") ?? "[]",
    ),
  );
  expect(persisted).toEqual([
    expect.objectContaining({
      label: "LinkedIn",
      url: "https://www.linkedin.com/feed/",
    }),
  ]);

  await linkedIn.click();
  await expect(browser.getByRole("textbox", { name: "URL bar" })).toHaveValue(
    "https://www.linkedin.com/feed/",
  );

  await browser.getByRole("button", { name: "Add shortcut" }).click();
  await expect(form).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(form).toBeHidden();
  await expect(browser).toBeVisible();

  await browser.getByRole("button", { name: "Add shortcut" }).click();
  await form.getByRole("button", { name: "Cancel" }).click();
  await expect(form).toBeHidden();
  await expect(browser).toBeVisible();
});

test("shortcut rail enforces the six-icon capacity", async ({ page }) => {
  await boot(page, [
    { id: "one", label: "LinkedIn", url: "https://linkedin.com" },
    { id: "two", label: "Threads", url: "https://threads.net" },
    { id: "three", label: "Bluesky", url: "https://bsky.app" },
  ]);
  const browser = page.getByRole("dialog", { name: "Browser overlay" });
  await expect(browser.getByText("6/6")).toBeVisible();
  await expect(
    browser.getByRole("button", { name: "Add shortcut" }),
  ).toHaveCount(0);
});
