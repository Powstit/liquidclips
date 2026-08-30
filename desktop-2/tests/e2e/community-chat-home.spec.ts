import { test, expect, type Page } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";

import { harnessAssertShell, seedAuthenticatedShell } from "./_auth-harness";

const messages = [
  {
    id: "msg-kade",
    user_id: "kade",
    username: "Kade",
    avatar_url: "/brand/kade/kade-community-mode.webp",
    channel: "global",
    content: "Wednesday campaign drop is live. Check the campaign brief before clipping.",
    role: "bot",
    pinned: true,
    announcement_id: "ann-1",
    created_at: "2026-07-02T08:00:00Z",
    arcade_high_score: 0,
  },
  {
    id: "msg-lucia",
    user_id: "lucia",
    username: "@lucia",
    avatar_url: null,
    channel: "global",
    content: "The side-by-side reaction layout is landing cleanly.",
    role: "member",
    pinned: false,
    announcement_id: null,
    created_at: "2026-07-02T08:05:00Z",
    arcade_high_score: 0,
  },
  {
    id: "msg-long",
    user_id: "marcus",
    username: "@marcus",
    avatar_url: null,
    channel: "global",
    content: "Long-form feedback stays readable without widening the conversation: the opening beat lands, the reaction remains visible, and the caption has enough breathing room to scan before the next cut. ".repeat(3),
    role: "member",
    pinned: false,
    announcement_id: null,
    created_at: "2026-07-02T08:08:00Z",
    arcade_high_score: 0,
  },
  {
    id: "msg-media",
    user_id: "ava",
    username: "@ava",
    avatar_url: null,
    channel: "global",
    content: "Launch energy https://media.giphy.com/media/liquidclips-test/giphy.gif",
    role: "member",
    pinned: false,
    announcement_id: null,
    created_at: "2026-07-02T08:10:00Z",
    arcade_high_score: 0,
  },
];

/**
 * D1 (2026-07-12) · JWT + backend seeds now flow through the canonical
 * `_auth-harness`. Kept the two wrappers so downstream call sites read
 * cleanly.
 */
async function seedAuth(_page: Page): Promise<void> {
  /* JWT already seeded inside seedAuthenticatedShell — nothing to do. */
}

async function interceptBase(page: Page, tier: "solo" | "agency" = "solo"): Promise<void> {
  await seedAuthenticatedShell(page, { tier });
}

async function interceptChat(
  page: Page,
  options: {
    offline?: boolean;
    sendStatus?: number;
    viewerRole?: "founder" | "staff" | "mod" | "member";
  } = {},
): Promise<void> {
  await page.route(/api\.liquidclips\.app\/chat\/messages/, (route) => {
    if (options.offline) return route.abort("internetdisconnected");
    const url = new URL(route.request().url());
    const channel = url.searchParams.get("channel") === "agency-vip"
      ? "agency-vip"
      : "global";
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        channel,
        messages: channel === "global" ? messages : [],
        can_write: true,
        viewer_role: options.viewerRole ?? "member",
      }),
    });
  });
  await page.route(/api\.liquidclips\.app\/chat\/message$/, (route) => {
    const status = options.sendStatus ?? 200;
    if (status !== 200) {
      return route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify({ detail: "send unavailable" }),
      });
    }
    const body = route.request().postDataJSON() as { channel: string; content: string };
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        message: {
          ...messages[1],
          id: "msg-sent",
          user_id: "community-harness",
          username: "clipper",
          channel: body.channel,
          content: body.content,
          created_at: new Date().toISOString(),
        },
      }),
    });
  });
}

async function interceptMedia(
  page: Page,
  options: { status?: number; setupRequired?: boolean } = {},
): Promise<void> {
  await page.route(/api\.liquidclips\.app\/chat\/media\/(giphy|pexels)/, (route) => {
    if (options.setupRequired) {
      return route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ detail: "setup_required" }),
      });
    }
    const status = options.status ?? 200;
    if (status !== 200) {
      return route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify({ detail: "media unavailable" }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        provider: "giphy",
        results: [{
          id: "gif-reaction",
          preview_url: "https://media.giphy.com/media/liquidclips-preview/giphy.gif",
          full_url: "https://media.giphy.com/media/liquidclips-full/giphy.gif",
          title: "Reaction applause",
        }],
      }),
    });
  });
  await page.route(/media\.giphy\.com\/media\/.*\/giphy\.gif/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "image/svg+xml",
      body: [
        '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360">',
        '<defs><linearGradient id="g"><stop stop-color="#ff1a8c"/><stop offset="1" stop-color="#15122c"/></linearGradient></defs>',
        '<rect width="640" height="360" rx="24" fill="url(#g)"/>',
        '<circle cx="250" cy="170" r="54" fill="#fff" opacity=".9"/>',
        '<circle cx="390" cy="170" r="54" fill="#fff" opacity=".9"/>',
        '<text x="320" y="300" text-anchor="middle" fill="white" font-family="sans-serif" font-size="34">REACTION APPLAUSE</text>',
        "</svg>",
      ].join(""),
    }),
  );
}

test.describe("Community chat home", () => {
  for (const viewport of [
    { width: 1040, height: 680 },
    { width: 1280, height: 820 },
    { width: 1440, height: 900 },
  ]) {
    test(`real chat layout · ${viewport.width}×${viewport.height}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await seedAuth(page);
      await interceptBase(page);
      await interceptChat(page);
      await interceptMedia(page);
      // 2026-08-30 · Two-pipeline routing rule (LOCKED 2026-07-10)
      // means Design-OS routes like `community` live UNDER the outer
      // `#/home` hash. The old `#/community` outer-hash goto worked
      // pre-lock but was silently broken after. Now we land on the
      // canonical outer hash, wait for the shell, then click the
      // Community nav button — the same path a real user takes.
      await page.goto("/?skipIntro=1#/home", { waitUntil: "domcontentloaded" });
      await harnessAssertShell(page);
      await page.getByRole("button", { name: "Community", exact: true }).click();

      const home = page.getByTestId("community-chat-home");
      await expect(home).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText("Wednesday campaign drop is live. Check the campaign brief before clipping.")).toBeVisible();
      await expect(page.locator('[data-room-id="global"]')).toHaveAttribute("data-active", "true");
      await expect(page.locator('[data-room-id="clippers-lounge"]')).toHaveAttribute("data-pending", "true");
      await expect(page.locator(".lc-chat-toggle")).toHaveCount(0);
      await expect(page.locator(".lc-chat-row-media")).toHaveCount(1);

      const geometry = await page.evaluate(() => {
        const home = document.querySelector(".lc-community-chat") as HTMLElement;
        /* D1-cluster-H test:185 (2026-07-12) · `<h1 data-route-title>`
         * is nested under `<header>` inside `.lc-community-stage`; the
         * direct-child `>` selector never matched. Use a descendant
         * selector so the geometry probe finds the real route title. */
        const routeTitle = document.querySelector(
          ".lc-community-stage [data-route-title]",
        ) as HTMLElement;
        return {
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
          bodyScrollWidth: document.documentElement.scrollWidth,
          streamOverflow: getComputedStyle(
            document.querySelector(".lc-community-message-stream") as HTMLElement,
          ).overflowY,
          homeBottom: home.getBoundingClientRect().bottom,
          homeHeight: home.getBoundingClientRect().height,
          routeTitleWidth: routeTitle.getBoundingClientRect().width,
          routeTitleHeight: routeTitle.getBoundingClientRect().height,
        };
      });
      expect(geometry.bodyScrollWidth).toBeLessThanOrEqual(geometry.viewportWidth);
      expect(geometry.streamOverflow).toMatch(/auto|scroll/);
      expect(geometry.homeBottom).toBeGreaterThanOrEqual(geometry.viewportHeight - 40);
      expect(geometry.homeBottom).toBeLessThanOrEqual(geometry.viewportHeight);
      expect(geometry.homeHeight).toBeGreaterThan(viewport.height * 0.72);
      expect(geometry.routeTitleWidth).toBeLessThanOrEqual(1);
      expect(geometry.routeTitleHeight).toBeLessThanOrEqual(1);

      const evidenceDir = path.resolve(
        process.cwd(),
        "docs",
        "ui-master",
        "evidence",
        "stage-3",
        `${viewport.width}x${viewport.height}`,
      );
      fs.mkdirSync(evidenceDir, { recursive: true });
      await page.screenshot({
        path: path.join(evidenceDir, "community-populated.png"),
        fullPage: false,
      });
    });
  }

  test("pending room, agency gate, and visibility preference are honest", async ({ page }) => {
    await seedAuth(page);
    await interceptBase(page, "solo");
    await interceptChat(page);
    await page.goto("/?skipIntro=1#/home", { waitUntil: "domcontentloaded" });
    await harnessAssertShell(page);
    await page.getByRole("button", { name: "Community", exact: true }).click();
      await harnessAssertShell(page);
    await expect(page.getByTestId("community-chat-home")).toBeVisible({ timeout: 20_000 });

    await page.locator('[data-room-id="clippers-lounge"]').click();
    await expect(page.getByText("This room needs a backend channel before messages can be stored.")).toBeVisible();
    await expect(page.getByText("No placeholder messages or member counts are being shown.")).toBeVisible();

    await page.locator('[data-room-id="agency-vip"]').click();
    await expect(page.getByText("Agency VIP is available only to an active Agency account.")).toBeVisible();

    const presence = page.getByTestId("community-presence-toggle");
    await expect(presence).toHaveAttribute("data-online", "1");
    await presence.click();
    await expect(presence).toHaveAttribute("data-online", "0");
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("community-presence-toggle")).toHaveAttribute("data-online", "0");
  });

  test("loading history is explicit before real messages arrive", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await seedAuth(page);
    await interceptBase(page);
    let releaseHistory!: () => void;
    const historyGate = new Promise<void>((resolve) => {
      releaseHistory = resolve;
    });
    await page.route(/api\.liquidclips\.app\/chat\/messages/, async (route) => {
      await historyGate;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          channel: "global",
          messages,
          can_write: true,
          viewer_role: "member",
        }),
      });
    });
    await page.goto("/?skipIntro=1#/home", { waitUntil: "domcontentloaded" });
    await harnessAssertShell(page);
    await page.getByRole("button", { name: "Community", exact: true }).click();
      await harnessAssertShell(page);

    await expect(page.getByText("Loading real messages…")).toBeVisible();
    const evidenceDir = path.resolve(
      process.cwd(),
      "docs",
      "ui-master",
      "evidence",
      "stage-4",
      "1440x900",
    );
    fs.mkdirSync(evidenceDir, { recursive: true });
    await page.screenshot({
      path: path.join(evidenceDir, "loading-history.png"),
      fullPage: false,
      timeout: 20_000,
    });
    releaseHistory();
    await expect(page.getByText("Wednesday campaign drop is live. Check the campaign brief before clipping.")).toBeVisible();
  });

  test("offline history and send failure keep actions recoverable", async ({ page }) => {
    await seedAuth(page);
    await interceptBase(page);
    await interceptChat(page, { offline: true });
    await page.goto("/?skipIntro=1#/home", { waitUntil: "domcontentloaded" });
    await harnessAssertShell(page);
    await page.getByRole("button", { name: "Community", exact: true }).click();
      await harnessAssertShell(page);
    await expect(page.getByText("Community chat is offline. Check your connection and retry.")).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();

    await page.unroute(/api\.liquidclips\.app\/chat\/messages/);
    await page.unroute(/api\.liquidclips\.app\/chat\/message$/);
    await interceptChat(page, { sendStatus: 503 });
    await page.getByRole("button", { name: "Retry" }).click();
    await expect(page.getByText("The side-by-side reaction layout is landing cleanly.")).toBeVisible();

    const composer = page.getByLabel("Message #global");
    await composer.fill("Keep this draft after failure");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText("Message could not be sent (503).")).toBeVisible();
    await expect(composer).toHaveValue("Keep this draft after failure");
  });

  test("GIF search returns a selectable result and media remains in-app", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await seedAuth(page);
    await interceptBase(page);
    await interceptChat(page);
    await interceptMedia(page);
    await page.goto("/?skipIntro=1#/home", { waitUntil: "domcontentloaded" });
    await harnessAssertShell(page);
    await page.getByRole("button", { name: "Community", exact: true }).click();
      await harnessAssertShell(page);
    await expect(page.getByTestId("community-chat-home")).toBeVisible({ timeout: 20_000 });

    await page.getByRole("button", { name: "Search GIFs and photos" }).click();
    const search = page.getByRole("textbox", { name: "Search GIFs", exact: true });
    await search.fill("applause");
    const result = page.getByRole("button", { name: "Use Reaction applause" });
    await expect(result).toBeVisible();

    const evidenceDir = path.resolve(
      process.cwd(),
      "docs",
      "ui-master",
      "evidence",
      "stage-4",
      "1440x900",
    );
    fs.mkdirSync(evidenceDir, { recursive: true });
    await page.screenshot({
      path: path.join(evidenceDir, "gif-picker.png"),
      fullPage: false,
    });

    await result.click();
    await expect(page.getByLabel("Message #global")).toHaveValue(
      "https://media.giphy.com/media/liquidclips-full/giphy.gif",
    );
    await expect(page.locator(".lc-chat-row-media")).toHaveCount(1);
  });

  test("media search distinguishes server failure from missing setup", async ({ page }) => {
    await seedAuth(page);
    await interceptBase(page);
    await interceptChat(page);
    await interceptMedia(page, { status: 500 });
    await page.goto("/?skipIntro=1#/home", { waitUntil: "domcontentloaded" });
    await harnessAssertShell(page);
    await page.getByRole("button", { name: "Community", exact: true }).click();
      await harnessAssertShell(page);
    await expect(page.getByTestId("community-chat-home")).toBeVisible({ timeout: 20_000 });

    await page.getByRole("button", { name: "Search GIFs and photos" }).click();
    await page.getByRole("textbox", { name: "Search GIFs", exact: true }).fill("failure");
    await expect(page.getByText("Media search returned 500.")).toBeVisible();
    await expect(page.getByTestId("lc-chat-media").getByRole("button", { name: "Retry" })).toBeVisible();

    await page.unroute(/api\.liquidclips\.app\/chat\/media\/(giphy|pexels)/);
    await interceptMedia(page, { setupRequired: true });
    await page.getByTestId("lc-chat-media").getByRole("button", { name: "Retry" }).click();
    await expect(
      page.getByText("Set GIPHY_API_KEY on the backend to enable GIF search."),
    ).toBeVisible();
  });

  test("shared floating chat preserves failed drafts and closes by keyboard", async ({ page }) => {
    await seedAuth(page);
    await interceptBase(page);
    await interceptChat(page, { sendStatus: 503 });
    await page.goto("/?skipIntro=1#/home", { waitUntil: "domcontentloaded" });
      await harnessAssertShell(page);

    const toggle = page.getByTestId("lc-chat-toggle");
    await expect(toggle).toBeVisible({ timeout: 20_000 });
    await toggle.click();
    await expect(page.getByTestId("lc-chat-panel")).toBeVisible();
    await expect(page.getByText("The side-by-side reaction layout is landing cleanly.")).toBeVisible();

    const composer = page.getByRole("textbox", { name: "Message #global" });
    await composer.fill("Floating chat keeps this draft");
    await page.getByTestId("lc-chat-panel").getByRole("button", { name: "Send" }).click();
    await expect(page.getByTestId("lc-chat-panel").getByText("Message could not be sent (503).")).toBeVisible();
    await expect(composer).toHaveValue("Floating chat keeps this draft");

    await page.keyboard.press("Escape");
    await expect(page.getByTestId("lc-chat-panel")).toHaveCount(0);
    await expect(toggle).toHaveAttribute("data-open", "false");
  });

  test("ordinary users can copy links but never receive moderation controls", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await seedAuth(page);
    await interceptBase(page);
    await interceptChat(page, { viewerRole: "member" });
    await page.goto("/?skipIntro=1#/home", { waitUntil: "domcontentloaded" });
    await harnessAssertShell(page);
    await page.getByRole("button", { name: "Community", exact: true }).click();
      await harnessAssertShell(page);
    const row = page.locator(".lc-chat-row", {
      hasText: "The side-by-side reaction layout is landing cleanly.",
    });
    await expect(row).toHaveAttribute("data-moderation-available", "false");
    await row.getByRole("button", { name: "Message actions for @lucia" }).click();
    await expect(row.getByRole("menuitem", { name: "Copy link to message" })).toBeVisible();
    await expect(row.getByRole("menuitem", { name: "Hide message" })).toHaveCount(0);
    await expect(row.getByRole("menuitem", { name: "Warn user" })).toHaveCount(0);
    await expect(row.getByRole("menuitem", { name: "Mute for 24 hours" })).toHaveCount(0);

    await row.getByRole("menuitem", { name: "Copy link to message" }).click();
    await expect(row.getByRole("menuitem", { name: "Link copied" })).toBeVisible();
    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboard).toContain("#/community?message=msg-lucia");
  });

  test("staff moderator actions call live contracts and surface success, auth, and server failures", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await seedAuth(page);
    await interceptBase(page);
    await interceptChat(page, { viewerRole: "staff" });
    await page.route(
      /api\.liquidclips\.app\/chat\/messages\/msg-lucia\/(hide|warn|mute24h)$/,
      (route) => {
        const action = new URL(route.request().url()).pathname.split("/").at(-1);
        if (action === "hide") {
          return route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              id: "msg-lucia",
              hidden: true,
              hidden_at: "2026-07-02T12:00:00Z",
              hidden_by_user_id: "community-harness",
              hide_reason: null,
            }),
          });
        }
        if (action === "warn") {
          return route.fulfill({
            status: 403,
            contentType: "application/json",
            body: JSON.stringify({ detail: "Staff role is no longer active." }),
          });
        }
        return route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ detail: "Moderation service unavailable." }),
        });
      },
    );
    page.on("dialog", (dialog) => void dialog.accept());
    await page.goto("/?skipIntro=1#/home", { waitUntil: "domcontentloaded" });
    await harnessAssertShell(page);
    await page.getByRole("button", { name: "Community", exact: true }).click();
      await harnessAssertShell(page);
    const row = page.locator(".lc-chat-row", {
      hasText: "The side-by-side reaction layout is landing cleanly.",
    });
    await expect(row).toHaveAttribute("data-moderation-available", "true");

    await row.click({ button: "right" });
    await expect(row.getByText("Moderator tools")).toBeVisible();
    await expect(row.getByRole("menuitem", { name: "Hide message" })).toBeEnabled();
    await expect(row.getByRole("menuitem", { name: "Warn user" })).toBeEnabled();
    await expect(row.getByRole("menuitem", { name: "Mute for 24 hours" })).toBeEnabled();

    const hideRequest = page.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        new URL(request.url()).pathname.endsWith("/chat/messages/msg-lucia/hide"),
    );
    await row.getByRole("menuitem", { name: "Hide message" }).click();
    expect((await hideRequest).postDataJSON()).toEqual({});
    await expect(page.getByText("Message hidden")).toBeVisible();

    await row.click({ button: "right" });
    const warnRequest = page.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        new URL(request.url()).pathname.endsWith("/chat/messages/msg-lucia/warn"),
    );
    await row.getByRole("menuitem", { name: "Warn user" }).click();
    expect((await warnRequest).postDataJSON()).toEqual({});
    await expect(page.getByText("Not authorised")).toBeVisible();
    await expect(page.getByText("Staff role is no longer active.")).toBeVisible();

    await row.click({ button: "right" });
    const muteRequest = page.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        new URL(request.url()).pathname.endsWith("/chat/messages/msg-lucia/mute24h"),
    );
    await row.getByRole("menuitem", { name: "Mute for 24 hours" }).click();
    expect((await muteRequest).postDataJSON()).toEqual({});
    await expect(page.getByText("Moderation failed")).toBeVisible();
    await expect(page.getByText("Moderation service unavailable.")).toBeVisible();

    const evidenceDir = path.resolve(
      process.cwd(),
      "docs/ui-master/evidence/stage-7/1440x900",
    );
    fs.mkdirSync(evidenceDir, { recursive: true });
    await page.screenshot({
      path: path.join(evidenceDir, "moderation-contract-gate.png"),
      fullPage: false,
    });
  });
});
