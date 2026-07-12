# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: e2e/button-audit.spec.ts >> button audit · every interactive control across 11 surfaces
- Location: tests/e2e/button-audit.spec.ts:238:1

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
  456 |       } catch (e) {
  457 |         routeFindings.push({
  458 |           route: r.label, mode: r.mode,
  459 |           testid: c.testid, text: c.text, role: c.role,
  460 |           classification: "FAIL",
  461 |           expectation: "click should land",
  462 |           observation: `click error: ${String((e as Error).message).slice(0, 80)}`,
  463 |         });
  464 |         await page.reload({ waitUntil: "domcontentloaded" });
  465 |         await page.waitForSelector(".lc-app", { timeout: 30_000 });
  466 |         await setMode(page, r.mode);
  467 |         await navigate(page, r.routeId);
  468 |         continue;
  469 |       }
  470 | 
  471 |       /* Gate 9 (2026-06-27) — wait up to 1500ms for an observable
  472 |        * delta. Gate 7's lazy SimulatorRouter routes mean a nav:click
  473 |        * triggers an async chunk fetch before the new surface mounts;
  474 |        * 150ms was too tight, causing audit to record "no observable
  475 |        * effect" for clicks that ARE swapping the route. Poll for a
  476 |        * route/aria/overlay/toast change every 80ms and exit early as
  477 |        * soon as one fires. If nothing in 1500ms, treat as FAIL — that's
  478 |        * the honest dead-control verdict. */
  479 |       const beforeForPoll = {
  480 |         url: beforeUrl,
  481 |         route: beforeRoute,
  482 |         mode: beforeMode,
  483 |         aria: beforeAriaSelected,
  484 |         overlayCount: beforeOverlayCount,
  485 |       };
  486 |       const overlaySelForPoll = '.lc-browse-overlay, .lc-drawer-host, [data-drawer-id], [role="menu"], [role="dialog"], [data-orbit-open="true"], [data-testid="avatar-orbit-menu"], [data-activation-status], [data-testid="create-panel"], [data-testid="home-create-panel"]';
  487 |       await page.waitForFunction(
  488 |         ({ before, sel }) => {
  489 |           const w = window as unknown as { __lcAuditToastCount?: number; __lcAuditNavCount?: number };
  490 |           const route = document.querySelector(".lc-app")?.getAttribute("data-route") ?? "";
  491 |           const mode = document.body.getAttribute("data-app-mode") ?? "";
  492 |           const aria = [...document.querySelectorAll("[aria-selected],[aria-checked],[aria-pressed],[aria-expanded],[aria-busy]")].map(
  493 |             (el) => `${el.tagName}:${el.getAttribute("aria-selected") || el.getAttribute("aria-checked") || el.getAttribute("aria-pressed") || el.getAttribute("aria-expanded") || el.getAttribute("aria-busy")}`,
  494 |           ).join("|");
  495 |           const overlayCount = document.querySelectorAll(sel).length;
  496 |           const toastCount = w.__lcAuditToastCount ?? 0;
  497 |           const navCount = w.__lcAuditNavCount ?? 0;
  498 |           return route !== before.route ||
  499 |             mode !== before.mode ||
  500 |             aria !== before.aria ||
  501 |             overlayCount !== before.overlayCount ||
  502 |             toastCount > 0 ||
  503 |             navCount > 0 ||
  504 |             window.location.href !== before.url;
  505 |         },
  506 |         { before: beforeForPoll, sel: overlaySelForPoll },
  507 |         { timeout: 1500, polling: 80 },
  508 |       ).catch(() => { /* timeout · the click was a true no-op · proceed with after-snapshot read */ });
  509 | 
  510 |       const afterUrl = page.url();
  511 |       const afterRoute = await page.evaluate(() => document.querySelector(".lc-app")?.getAttribute("data-route") ?? "");
  512 |       const afterMode = await page.evaluate(() => document.body.getAttribute("data-app-mode") ?? "");
  513 |       const afterAriaSelected = await page.evaluate(() => {
  514 |         return [...document.querySelectorAll("[aria-selected],[aria-checked],[aria-pressed],[aria-expanded],[aria-busy]")].map(
  515 |           (el) => `${el.tagName}:${el.getAttribute("aria-selected") || el.getAttribute("aria-checked") || el.getAttribute("aria-pressed") || el.getAttribute("aria-expanded") || el.getAttribute("aria-busy")}`,
  516 |         ).join("|");
  517 |       });
  518 | 
  519 |       const toastCount = await page.evaluate(() => {
  520 |         const w = window as unknown as { __lcAuditToastCount?: number };
  521 |         return w.__lcAuditToastCount ?? 0;
  522 |       });
  523 |       const navCount = await page.evaluate(() => {
  524 |         const w = window as unknown as { __lcAuditNavCount?: number };
  525 |         return w.__lcAuditNavCount ?? 0;
  526 |       });
  527 |       const afterOverlayCount = await page.evaluate(() => {
  528 |         const sel = '.lc-browse-overlay, .lc-drawer-host, [data-drawer-id], [role="menu"], [role="dialog"], [data-orbit-open="true"], [data-testid="avatar-orbit-menu"], [data-activation-status], [data-testid="create-panel"], [data-testid="home-create-panel"]';
  529 |         return document.querySelectorAll(sel).length;
  530 |       });
  531 | 
  532 |       const observable =
  533 |         beforeUrl !== afterUrl ||
  534 |         beforeRoute !== afterRoute ||
  535 |         beforeMode !== afterMode ||
  536 |         beforeAriaSelected !== afterAriaSelected ||
  537 |         toastCount > 0 ||
  538 |         navCount > 0 ||
  539 |         beforeOverlayCount !== afterOverlayCount;
  540 | 
  541 |       routeFindings.push({
  542 |         route: r.label, mode: r.mode,
  543 |         testid: c.testid, text: c.text, role: c.role,
  544 |         classification: observable ? "PASS" : "FAIL",
  545 |         expectation: "click produces observable state change",
  546 |         observation: observable
  547 |           ? `${beforeRoute !== afterRoute ? `route ${beforeRoute}→${afterRoute}; ` : ""}${beforeMode !== afterMode ? `mode ${beforeMode}→${afterMode}; ` : ""}${beforeAriaSelected !== afterAriaSelected ? "aria state changed; " : ""}${toastCount > 0 ? `toast(${toastCount}) emitted; ` : ""}${navCount > 0 ? `nav(${navCount}) emitted; ` : ""}${beforeOverlayCount !== afterOverlayCount ? `overlay/menu count ${beforeOverlayCount}→${afterOverlayCount}` : ""}`.trim()
  548 |           : "click had no observable effect (route, mode, aria, toast, overlays all unchanged)",
  549 |       });
  550 | 
  551 |       /* Every control gets a fresh authenticated baseline. Portal state,
  552 |        * mode radios, same-route create panels, and filter state otherwise
  553 |        * leak into the next control and turn valid clicks into stale-DOM
  554 |        * failures. Backend routes + init scripts survive reload. */
  555 |       await page.reload({ waitUntil: "domcontentloaded" });
> 556 |       await page.waitForSelector(".lc-app", { timeout: 30_000 });
      |                  ^ TimeoutError: page.waitForSelector: Timeout 30000ms exceeded.
  557 |       await setMode(page, r.mode);
  558 |       await navigate(page, r.routeId);
  559 |     }
  560 | 
  561 |     const totals: Record<string, number> = {};
  562 |     for (const f of routeFindings) totals[f.classification] = (totals[f.classification] || 0) + 1;
  563 |     routeSummaries.push({
  564 |       label: r.label,
  565 |       mode: r.mode,
  566 |       totals,
  567 |       consoleErrorsDelta: consoleErrors.length - errorsBefore,
  568 |       controlsAuditedCount: routeFindings.length,
  569 |     });
  570 |     allFindings.push(...routeFindings);
  571 |   }
  572 | 
  573 |   const failingControls = allFindings.filter((f) => f.classification === "FAIL");
  574 |   const overall: "GREEN" | "RED" = failingControls.length === 0 && consoleErrors.length === 0 ? "GREEN" : "RED";
  575 | 
  576 |   fs.mkdirSync(VERDICT_DIR, { recursive: true });
  577 |   const ts = new Date().toISOString().replace(/[:.]/g, "-");
  578 |   const verdictPath = path.join(VERDICT_DIR, `button-audit-${ts}.json`);
  579 |   const latestPath = path.join(VERDICT_DIR, `button-audit-latest.json`);
  580 |   const verdict: AuditVerdict = {
  581 |     startedAt: 0, finishedAt: Date.now(),
  582 |     overall,
  583 |     routeSummaries,
  584 |     failingControls,
  585 |     allFindings,
  586 |     consoleErrors,
  587 |   };
  588 |   fs.writeFileSync(verdictPath, JSON.stringify(verdict, null, 2));
  589 |   fs.writeFileSync(latestPath, JSON.stringify(verdict, null, 2));
  590 | 
  591 |   /* Attach the verdict so playwright shows it. */
  592 |   await testInfo.attach("button-audit", { body: JSON.stringify(verdict, null, 2), contentType: "application/json" });
  593 | 
  594 |   /* LC-UI-P0-001 (2026-06-26) — a RED verdict MUST fail the suite. The
  595 |    * prior "let the operator decide" stance let silent-success bugs ship
  596 |    * because the report was advisory only. Promotion gates are gates,
  597 |    * not advisories: failing controls or unhandled console errors fail
  598 |    * the build. The verdict files on disk remain the diagnostic trail. */
  599 |   if (overall === "RED") {
  600 |     const summary = [
  601 |       `button audit RED — ${failingControls.length} FAIL · ${consoleErrors.length} console error${consoleErrors.length === 1 ? "" : "s"}`,
  602 |       ...failingControls.slice(0, 12).map((f) => `  · [${f.route}] ${f.testid ?? f.text}: ${f.observation}`),
  603 |       ...consoleErrors.slice(0, 6).map((e) => `  · ${e}`),
  604 |     ].join("\n");
  605 |     throw new Error(summary);
  606 |   }
  607 | });
  608 | 
```