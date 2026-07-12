# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: e2e/agency-upgrade-cta-verify.spec.ts >> LC-UI-P0-001 · Agency upgrade CTA · authenticated click opens checkout OR shows fallback toast · NEVER silent success
- Location: tests/e2e/agency-upgrade-cta-verify.spec.ts:126:1

# Error details

```
TimeoutError: page.waitForSelector: Timeout 30000ms exceeded.
Call log:
  - waiting for locator('.lc-app') to be visible

```

# Page snapshot

```yaml
- generic [ref=e3]:
  - generic [ref=e5]:
    - img "Liquid Clips" [ref=e6]
    - generic [ref=e7]:
      - heading "Sign in to Liquid Clips" [level=1] [ref=e8]
      - generic [ref=e9]:
        - generic [ref=e10]: Email
        - textbox "Email" [active] [ref=e11]:
          - /placeholder: you@example.com
        - button "Send code" [ref=e12] [cursor=pointer]
  - region "Recent clips from Liquid Clips users" [ref=e13]:
    - generic [ref=e15]:
      - generic [ref=e16] [cursor=pointer]:
        - img [ref=e17]
        - generic [ref=e18]: $618
        - generic "muted" [ref=e19]: 🔇
        - generic [ref=e20]: "@featured"
      - generic [ref=e21] [cursor=pointer]:
        - img [ref=e22]
        - generic [ref=e23]: $424
        - generic "muted" [ref=e24]: 🔇
        - generic [ref=e25]: "@clipper-02"
      - generic [ref=e26] [cursor=pointer]:
        - img [ref=e27]
        - generic [ref=e28]: $331
        - generic "muted" [ref=e29]: 🔇
        - generic [ref=e30]: "@clipper-03"
      - generic [ref=e31] [cursor=pointer]:
        - img [ref=e32]
        - generic [ref=e33]: $273
        - generic "muted" [ref=e34]: 🔇
        - generic [ref=e35]: "@clipper-04"
      - generic [ref=e36] [cursor=pointer]:
        - img [ref=e37]
        - generic [ref=e38]: $512
        - generic "muted" [ref=e39]: 🔇
        - generic [ref=e40]: "@clipper-05"
      - generic [ref=e41] [cursor=pointer]:
        - img [ref=e42]
        - generic [ref=e43]: $189
        - generic "muted" [ref=e44]: 🔇
        - generic [ref=e45]: "@clipper-06"
      - generic [ref=e46] [cursor=pointer]:
        - img [ref=e47]
        - generic [ref=e48]: $475
        - generic "muted" [ref=e49]: 🔇
        - generic [ref=e50]: "@clipper-07"
      - generic [ref=e51] [cursor=pointer]:
        - img [ref=e52]
        - generic [ref=e53]: $246
        - generic "muted" [ref=e54]: 🔇
        - generic [ref=e55]: "@clipper-08"
      - generic [ref=e56] [cursor=pointer]:
        - img [ref=e57]
        - generic [ref=e58]: $394
        - generic "muted" [ref=e59]: 🔇
        - generic [ref=e60]: "@clipper-09"
      - generic [ref=e61] [cursor=pointer]:
        - img [ref=e62]
        - generic [ref=e63]: $556
        - generic "muted" [ref=e64]: 🔇
        - generic [ref=e65]: "@clipper-10"
      - generic [ref=e66] [cursor=pointer]:
        - img [ref=e67]
        - generic [ref=e68]: $618
        - generic "muted" [ref=e69]: 🔇
        - generic [ref=e70]: "@featured"
      - generic [ref=e71] [cursor=pointer]:
        - img [ref=e72]
        - generic [ref=e73]: $424
        - generic "muted" [ref=e74]: 🔇
        - generic [ref=e75]: "@clipper-02"
      - generic [ref=e76] [cursor=pointer]:
        - img [ref=e77]
        - generic [ref=e78]: $331
        - generic "muted" [ref=e79]: 🔇
        - generic [ref=e80]: "@clipper-03"
      - generic [ref=e81] [cursor=pointer]:
        - img [ref=e82]
        - generic [ref=e83]: $273
        - generic "muted" [ref=e84]: 🔇
        - generic [ref=e85]: "@clipper-04"
      - generic [ref=e86] [cursor=pointer]:
        - img [ref=e87]
        - generic [ref=e88]: $512
        - generic "muted" [ref=e89]: 🔇
        - generic [ref=e90]: "@clipper-05"
      - generic [ref=e91] [cursor=pointer]:
        - img [ref=e92]
        - generic [ref=e93]: $189
        - generic "muted" [ref=e94]: 🔇
        - generic [ref=e95]: "@clipper-06"
      - generic [ref=e96] [cursor=pointer]:
        - img [ref=e97]
        - generic [ref=e98]: $475
        - generic "muted" [ref=e99]: 🔇
        - generic [ref=e100]: "@clipper-07"
      - generic [ref=e101] [cursor=pointer]:
        - img [ref=e102]
        - generic [ref=e103]: $246
        - generic "muted" [ref=e104]: 🔇
        - generic [ref=e105]: "@clipper-08"
      - generic [ref=e106] [cursor=pointer]:
        - img [ref=e107]
        - generic [ref=e108]: $394
        - generic "muted" [ref=e109]: 🔇
        - generic [ref=e110]: "@clipper-09"
      - generic [ref=e111] [cursor=pointer]:
        - img [ref=e112]
        - generic [ref=e113]: $556
        - generic "muted" [ref=e114]: 🔇
        - generic [ref=e115]: "@clipper-10"
    - paragraph [ref=e116]:
      - text: 870 clippers ·
      - generic [ref=e117]: $4018
      - text: paid last week
```

# Test source

```ts
  71  |   await page.waitForTimeout(400);
  72  | 
  73  |   const cta = page.locator('[data-testid="agency-preview-upgrade-cta"]');
  74  |   await expect(cta).toBeVisible({ timeout: 5_000 });
  75  |   await expect(cta).toBeEnabled();
  76  | 
  77  |   /* Capture the label · proves the button is the real preview banner,
  78  |    * not a stale mount. */
  79  |   const baseText = (await cta.textContent()) ?? "";
  80  |   expect(baseText).toContain("Upgrade to Agency");
  81  |   expect(baseText).toContain("/mo");
  82  | 
  83  |   /* Exercise the same pointer path as a customer. */
  84  |   await cta.click();
  85  | 
  86  |   /* LC-UI-P0-001 (2026-06-26) — the prior version of this assertion
  87  |    * had an `else` branch that asserted `1 === 1` whenever no toast
  88  |    * fired. That made the spec a fake pass: the broken silent-success
  89  |    * path (Mock returning {ok:true} without an opener) sailed through
  90  |    * with no observable signal.
  91  |    *
  92  |    * After the adapter fix, the Agency CTA in an authenticated path
  93  |    * MUST either:
  94  |    *   (a) succeed at opening the real account-app checkout · in the
  95  |    *       Playwright dev env there is no Tauri opener, so the real
  96  |    *       adapter's openSmart throws → handler catches → bus emits a
  97  |    *       toast tagged "checkout".
  98  |    *   (b) fall through to the explicit failure toast.
  99  |    * Either way, a toast event MUST land within 4s. No toast = real bug.
  100 |    */
  101 |   await page.waitForFunction(
  102 |     () => {
  103 |       const w = window as unknown as { __lcToastCapture?: Array<unknown> };
  104 |       return (w.__lcToastCapture?.length ?? 0) > 0;
  105 |     },
  106 |     { timeout: 4_000 },
  107 |   );
  108 | 
  109 |   const toasts = await page.evaluate(() => {
  110 |     const w = window as unknown as { __lcToastCapture?: Array<unknown> };
  111 |     return w.__lcToastCapture ?? [];
  112 |   });
  113 | 
  114 |   const t = toasts[0] as { kind?: string; title?: string };
  115 |   expect(t.kind).toBe("error");
  116 |   expect((t.title ?? "").toLowerCase()).toContain("checkout");
  117 |   await expect(cta).toHaveAttribute("data-checkout-failed", "1");
  118 |   await expect(cta).toContainText("Retry Agency checkout");
  119 | });
  120 | 
  121 | /* LC-UI-P0-001 regression test — Agency upgrade CTA must EITHER open
  122 |  * an external checkout URL OR surface a visible failure toast. Mock
  123 |  * returning {ok:true} without an opener is forbidden in authenticated
  124 |  * paths. This is the gate that proves the adapter selection fix and
  125 |  * the call-site await fix hold together. */
  126 | test("LC-UI-P0-001 · Agency upgrade CTA · authenticated click opens checkout OR shows fallback toast · NEVER silent success", async ({ page }) => {
  127 |   await installBackendStubs(page, { tier: "pro" });
  128 |   const consoleErrors: string[] = [];
  129 |   page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));
  130 | 
  131 |   /* Capture toasts + capture every navigation/open attempt the page makes. */
  132 |   await page.addInitScript(() => {
  133 |     const w = window as unknown as {
  134 |       __lcToastCapture?: Array<unknown>;
  135 |       __lcOpenAttempts?: Array<string>;
  136 |       __lcBus?: { on: (e: string, h: (p: unknown) => void) => () => void };
  137 |     };
  138 |     w.__lcToastCapture = [];
  139 |     w.__lcOpenAttempts = [];
  140 | 
  141 |     /* Monkey-patch window.open to record (the real adapter's openSmart
  142 |      * falls back to window.open in browser preview). */
  143 |     const realOpen = window.open;
  144 |     window.open = ((...args: Parameters<typeof window.open>) => {
  145 |       try {
  146 |         const url = String(args[0] ?? "");
  147 |         if (url) w.__lcOpenAttempts!.push(url);
  148 |       } catch { /* noop */ }
  149 |       return realOpen.apply(window, args);
  150 |     }) as typeof window.open;
  151 | 
  152 |     const tryWire = () => {
  153 |       const b = w.__lcBus;
  154 |       if (b && typeof b.on === "function") {
  155 |         b.on("toast", (p) => { w.__lcToastCapture!.push(p); });
  156 |       } else {
  157 |         setTimeout(tryWire, 50);
  158 |       }
  159 |     };
  160 |     tryWire();
  161 |   });
  162 | 
  163 |   /* Authenticated path · JWT present · the adapter MUST be the real one. */
  164 |   await page.addInitScript(() => {
  165 |     try {
  166 |       window.localStorage.setItem("lc.license.jwt.v1", "harness.fake.jwt");
  167 |       window.localStorage.setItem("lc.mode", "agency");
  168 |     } catch { /* noop */ }
  169 |   });
  170 |   await page.goto("/?skipIntro=1#/home", { waitUntil: "domcontentloaded" });
> 171 |   await page.waitForSelector(".lc-app", { timeout: 30_000 });
      |              ^ TimeoutError: page.waitForSelector: Timeout 30000ms exceeded.
  172 | 
  173 |   await page.waitForFunction(
  174 |     () => {
  175 |       const w = window as unknown as { __lcBus?: unknown };
  176 |       return !!w.__lcBus;
  177 |     },
  178 |     { timeout: 5_000 },
  179 |   );
  180 |   await page.evaluate(() => {
  181 |     try { window.localStorage.setItem("lc.mode", "agency"); } catch { /* noop */ }
  182 |     const w = window as unknown as { __lcBus?: { emit: (e: string, p: unknown) => void } };
  183 |     w.__lcBus?.emit?.("mode:change", { mode: "agency" });
  184 |   });
  185 |   await page.waitForTimeout(400);
  186 | 
  187 |   const cta = page.locator('[data-testid="agency-preview-upgrade-cta"]');
  188 |   await expect(cta).toBeVisible({ timeout: 5_000 });
  189 |   await expect(cta).toBeEnabled();
  190 |   await cta.click();
  191 | 
  192 |   /* Wait up to 4s for EITHER an open attempt OR a toast. */
  193 |   await page.waitForFunction(
  194 |     () => {
  195 |       const w = window as unknown as {
  196 |         __lcOpenAttempts?: Array<string>;
  197 |         __lcToastCapture?: Array<unknown>;
  198 |       };
  199 |       const opens = w.__lcOpenAttempts?.length ?? 0;
  200 |       const toasts = w.__lcToastCapture?.length ?? 0;
  201 |       return opens > 0 || toasts > 0;
  202 |     },
  203 |     { timeout: 4_000 },
  204 |   );
  205 | 
  206 |   const { opens, toasts } = await page.evaluate(() => {
  207 |     const w = window as unknown as {
  208 |       __lcOpenAttempts?: Array<string>;
  209 |       __lcToastCapture?: Array<unknown>;
  210 |     };
  211 |     return { opens: w.__lcOpenAttempts ?? [], toasts: w.__lcToastCapture ?? [] };
  212 |   });
  213 | 
  214 |   /* At least one of A or B must be true. */
  215 |   const openedCheckout = opens.some((u) => /account\.liquidclips\.app/.test(u) || /dashboard#plans/.test(u));
  216 |   const toastedFailure = toasts.some((t) => {
  217 |     const tt = t as { kind?: string; title?: string };
  218 |     return tt.kind === "error" && /checkout/i.test(tt.title ?? "");
  219 |   });
  220 |   expect(openedCheckout || toastedFailure).toBe(true);
  221 | 
  222 |   /* Belt + braces: clicking the live handler must NOT crash. */
  223 |   expect(consoleErrors.filter((e) => !/tauri-adapter|favicon|sourcemap/i.test(e))).toEqual([]);
  224 | });
  225 | 
```