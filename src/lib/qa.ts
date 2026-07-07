/**
 * qa.ts · Liquid Clips local QA control surface
 *
 * NOT a user feature. Only attaches when one of:
 *   - import.meta.env.VITE_LC_QA === "true" (build-time opt-in for QA bundles)
 *   - import.meta.env.DEV (vite dev)
 *   - localStorage["lc.qa.enabled"] === "1" (runtime opt-in)
 *
 * Once attached, `window.__lcQA` exposes a deterministic API for driving
 * routing, mode, overlays, and DOM snapshots without OS-level UI clicks.
 *
 *   await window.__lcQA.route("home")
 *   window.__lcQA.mode("agency")
 *   window.__lcQA.openOverlay("browse")
 *   window.__lcQA.closeOverlay()
 *   window.__lcQA.snapshot()           → hard-proof object
 *   await window.__lcQA.runVerification()
 *
 * `runVerification()` drives all four required surfaces (Home Clipper,
 * Home Agency, Browse overlay, My Clips) and writes per-surface reports
 * to `$APPDATA/qa/<label>.json` plus a rollup at `$APPDATA/qa/all.json`,
 * so an external harness can read deterministic verdicts off disk
 * without devtools or AppleScript.
 */

import { bus } from "../design-os/bridge";
import { useBrowseOverlay, WHOP_REWARDS_URL } from "../state/browseOverlay";
import { hasJwt, getAuthSource, LICENSE_JWT_STORAGE_KEY } from "./authStorage";
import type { RouteId } from "../design-os/bridge";
import {
  assertSurfaceContract,
  getSurfaceContract,
  type SurfaceId,
} from "../design-os/surfaces/surfaceRegistry";

const QA_GATE_KEY = "lc.qa.enabled";
const QA_AUTOBOOT_KEY = "lc.qa.autoboot";
const MODE_STORAGE_KEY = "lc.mode";

type Mode = "clipper" | "agency";

export interface QASnapshot {
  takenAt: number;
  auth: {
    hasJwt: boolean;
    authSource: string;
    localStorageJwtPresent: boolean;
  };
  shell: {
    appPresent: boolean;
    designOsBodyActive: string | null;
    route: string | null;
    world: string | null;
    mode: Mode | string | null;
  };
  dashboard: {
    loginPresent: boolean;
    stagePresent: boolean;
    bannerPresent: boolean;
    tilesCount: number;
    earnPresent: boolean;
    sponsoredRewardPresent: boolean;
  };
  kade: {
    classList: string | null;
    placement: "center" | "helper-right" | "bottom-right" | "mini" | null;
    rectWidth: number | null;
  };
  clipCards: {
    count: number;
    firstPreviewBgIncludesKade: boolean;
    firstPreviewBgUrl: string | null;
  };
  overlay: {
    browseOpen: boolean;
    browseUrl: string | null;
  };
  labels: {
    createClips: boolean;
    myClips: boolean;
    findRewards: boolean;
    trackEarnings: boolean;
    sponsoredReward: boolean;
    viaWhop: boolean;
    clipperPillVisible: boolean;
    agencyPillVisible: boolean;
  };
  /** Atmosphere/world layer evidence. The previous QA only checked
   *  `data-world` attribute existed, which let a flat-black regression
   *  ship while reporting PASS. Every field here is hard evidence the
   *  cinematic world is actually rendering. */
  atmosphere: {
    worldMounted: boolean;
    worldSceneMounted: boolean;
    /** Resolved url(...) for .lc-world-scene background-image. */
    worldSceneBgUrl: string | null;
    /** Did the world webp actually decode? Probed via new Image(). */
    worldImageLoadable: boolean;
    worldCanvasMounted: boolean;
    consoleNavMounted: boolean;
    topHudMounted: boolean;
    stickyKadeMounted: boolean;
    /** Outer-shell atmosphere image (lc-deck-atmosphere). */
    deckAtmospherePresent: boolean;
    deckAtmosphereBgUrl: string | null;
    /** Workstation frame translucency — alpha of its computed bg. If the
     *  frame is fully opaque, it hides the world even when WorldLayer
     *  mounts correctly. Null on routes that don't render the frame. */
    workstationFrameBgAlpha: number | null;
  };
  /** PHASE 1 viewport-discipline evidence (locked 2026-06-25). Catches
   *  the landing-page hero pattern (sim-welcome + 80px sim-h1 +
   *  sub-copy) that pushes the working surface below the fold on
   *  Workstation / Schedule / Earn / Campaigns. */
  viewport: {
    simWelcomePresent: boolean;
    simH1Present: boolean;
    routeHeadPresent: boolean;
    routeHeadHeight: number | null;
  };
  /** PHASE 2 split-workbench evidence (locked 2026-06-25). Workstation
   *  must use a split-pane layout (grid + inspector), with internal
   *  scrolling — not a whole-page vertical stack. Null on non-
   *  Workstation surfaces. */
  workbench: {
    splitBodyPresent: boolean;
    inspectorPresent: boolean;
    inspectorHasClipFlag: string | null;
    /** Computed `overflow` on `.lc-app` for this route. On workstation
     *  it must be `hidden` so internal scroll regions own the scroll. */
    appOverflow: string | null;
  };
  /** STAGE B-1 registry-wiring evidence (locked 2026-06-26). WorldLayer
   *  / KadeController / ClipCard now resolve their visual assets via
   *  `assetRegistry.getWorld/getKade/getClipCardFallback`. The `*-
   *  registry-resolved` flags they expose on the DOM must read "true";
   *  any "false" means the registry doesn't carry that asset and the
   *  component is on its hardcoded fallback. */
  registry: {
    worldRegistryResolved: string | null;
    worldRegistryId: string | null;
    kadeRegistryResolved: string | null;
    kadeRegistryId: string | null;
    clipFallbackId: string | null;
    clipFallbackResolved: string | null;
    /** Count of any DOM elements that opted into the registry-resolved
     *  pattern and reported `false`. Failure signal — surfaces drift
     *  the moment a new asset isn't catalogued. */
    unresolvedCount: number;
  };
}

export interface SurfaceReport {
  label: string;
  intent: {
    route: string;
    mode: Mode;
    openBrowse?: boolean;
  };
  passConditions: Record<string, boolean>;
  passed: boolean;
  snapshot: QASnapshot;
}

export interface VerificationReport {
  startedAt: number;
  finishedAt: number;
  allPassed: boolean;
  surfaces: SurfaceReport[];
}

export function qaGateEnabled(): boolean {
  try {
    const env = (import.meta as unknown as { env?: Record<string, string | boolean> }).env;
    if (env?.VITE_LC_QA === "true") return true;
    if (env?.DEV === true) return true;
    if (typeof window !== "undefined" && window.localStorage.getItem(QA_GATE_KEY) === "1") {
      return true;
    }
  } catch {
    /* noop */
  }
  return false;
}

function autoBootEnabled(): boolean {
  try {
    const env = (import.meta as unknown as { env?: Record<string, string | boolean> }).env;
    if (env?.VITE_LC_QA === "true") return true;
    if (typeof window !== "undefined" && window.localStorage.getItem(QA_AUTOBOOT_KEY) === "1") {
      return true;
    }
  } catch {
    /* noop */
  }
  return false;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function route(name: string): Promise<void> {
  bus.emit("nav:click", { route: name as RouteId });
  try {
    window.location.hash = `#/${name}`;
  } catch {
    /* noop */
  }
  await sleep(400);
}

function setMode(m: Mode): void {
  try {
    window.localStorage.setItem(MODE_STORAGE_KEY, m);
    bus.emit("mode:change", { mode: m });
  } catch {
    /* noop */
  }
}

function openOverlay(name: "browse"): void {
  if (name === "browse") {
    useBrowseOverlay.getState().openWith(WHOP_REWARDS_URL, "browse-campaign");
  }
}

function closeOverlay(): void {
  try {
    useBrowseOverlay.getState().close();
  } catch {
    /* noop */
  }
}

function parseBgUrl(computed: string): string | null {
  return computed.match(/url\(["']?([^"')]+)["']?\)/)?.[1] ?? null;
}

function parseBgAlpha(computed: string): number | null {
  // rgba(r,g,b,a) or rgb(r,g,b). Returns 1 for rgb() (opaque). Returns null
  // if neither matched (e.g. `transparent`, gradient-only, or unset).
  const rgba = computed.match(/rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(?:,\s*([\d.]+)\s*)?\)/);
  if (!rgba) return null;
  return rgba[1] !== undefined ? Number(rgba[1]) : 1;
}

async function probeImage(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image();
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      resolve(ok);
    };
    img.onload = () => finish(img.naturalWidth > 0 && img.naturalHeight > 0);
    img.onerror = () => finish(false);
    // Timeout · don't let a stuck request hang verification.
    setTimeout(() => finish(false), 3000);
    img.src = url;
  });
}

function probeClipPreviewBackground(): string {
  // Static probe — temporarily inject a card structure off-screen so we can
  // resolve the .lc-clip-preview CSS rule even when no real clip data is
  // rendered. This tests the wiring, independent of sidecar fixture state.
  const wrap = document.createElement("div");
  wrap.style.cssText = "position:fixed;left:-9999px;top:-9999px;width:200px;height:300px;";
  wrap.innerHTML = `<div class="lc-clip-card"><div class="lc-clip-shell"><div class="lc-clip-preview"></div></div></div>`;
  document.body.appendChild(wrap);
  try {
    const previewEl = wrap.querySelector<HTMLElement>(".lc-clip-preview");
    return previewEl ? getComputedStyle(previewEl).backgroundImage : "";
  } finally {
    wrap.remove();
  }
}

async function snapshot(): Promise<QASnapshot> {
  const app = document.querySelector<HTMLElement>(".lc-app");
  const stage = document.querySelector(".lc-home-stage");
  const banner = document.querySelector(".lc-home-banner");
  const tiles = document.querySelectorAll(".lc-ctile");
  const earn = document.querySelector(".lc-home-earn");
  const sponsored = document.querySelector(".lc-srs");
  const login = document.querySelector(".lc-login");
  const kade = document.querySelector<HTMLElement>(".lc-sticky-kade");
  const clipCards = document.querySelectorAll(".lc-clip-card");
  const firstPreview = document.querySelector<HTMLElement>(".lc-clip-preview");

  // Atmosphere · evidence the world layer is actually painting, not just
  // mounted with `data-world` set.
  const world = document.querySelector<HTMLElement>(".lc-world");
  const worldScene = document.querySelector<HTMLElement>(".lc-world-scene");
  const worldCanvas = document.querySelector<HTMLElement>(".lc-world-canvas");
  const consoleNav = document.querySelector(".lc-rail, .lc-nav");
  const topHud = document.querySelector(".lc-hud");
  const deckAtmosphere = document.querySelector<HTMLElement>(".lc-deck-atmosphere");
  const workstationFrame = document.querySelector<HTMLElement>(".lc-ws-frame");
  const worldSceneBgUrl = worldScene ? parseBgUrl(getComputedStyle(worldScene).backgroundImage) : null;
  const deckAtmosphereBgUrl = deckAtmosphere ? parseBgUrl(getComputedStyle(deckAtmosphere).backgroundImage) : null;
  const workstationFrameBgAlpha = workstationFrame
    ? parseBgAlpha(getComputedStyle(workstationFrame).backgroundColor)
    : null;
  const worldImageLoadable = worldSceneBgUrl ? await probeImage(worldSceneBgUrl) : false;

  const simWelcome = document.querySelector(".sim-welcome");
  const simH1 = document.querySelector(".sim-h1");
  const routeHead = document.querySelector<HTMLElement>(".lc-route-head");
  const routeHeadHeight = routeHead ? Math.round(routeHead.getBoundingClientRect().height) : null;

  const splitBody = document.querySelector(".lc-ws-body");
  const inspector = document.querySelector<HTMLElement>(".lc-ws-body-inspector");
  const appOverflow = app ? getComputedStyle(app).overflow : null;

  // Stage B-1 · registry resolution evidence. WorldLayer / KadeController /
  // ClipCard set data-* flags so QA can confirm the live components are
  // reading from the registry instead of their old hardcoded maps.
  const worldRegistryResolved = world?.dataset.worldRegistryResolved ?? null;
  const worldRegistryId = world?.dataset.worldRegistryId ?? null;
  const kadeHost = document.querySelector<HTMLElement>(".lc-kade-host");
  const kadeRegistryResolved = kadeHost?.dataset.kadeRegistryResolved ?? null;
  const kadeRegistryId = kadeHost?.dataset.kadeRegistryId ?? null;
  const clipFallbackId = firstPreview?.dataset.clipFallbackId ?? null;
  const clipFallbackResolved = firstPreview?.dataset.clipFallbackResolved ?? null;
  // Count any registry-aware element that reported `false`. The matcher
  // is generic so every future registry-wired surface contributes to one
  // failure signal.
  const unresolvedCount = document.querySelectorAll(
    "[data-world-registry-resolved=\"false\"],[data-kade-registry-resolved=\"false\"],[data-clip-fallback-resolved=\"0\"]",
  ).length;
  // Prefer the real card preview's resolved background; fall back to a
  // synthetic probe so the CSS rule itself is verified when no card is
  // present.
  const previewBg = firstPreview
    ? getComputedStyle(firstPreview).backgroundImage
    : probeClipPreviewBackground();

  let mode: string | null = null;
  let jwtPresent = false;
  try {
    mode = window.localStorage.getItem(MODE_STORAGE_KEY);
    jwtPresent = !!window.localStorage.getItem(LICENSE_JWT_STORAGE_KEY);
  } catch {
    /* noop */
  }

  const kadeClassList = kade?.className?.trim() ?? null;
  const placementMatch = kadeClassList?.match(/is-(center|helper-right|bottom-right|mini)/);
  const kadeRect = kade?.getBoundingClientRect();

  const browseState = useBrowseOverlay.getState();

  const allText = (document.body.innerText || "").toLowerCase();

  const firstBgUrl = parseBgUrl(previewBg);

  return {
    takenAt: Date.now(),
    auth: {
      hasJwt: hasJwt(),
      authSource: getAuthSource(),
      localStorageJwtPresent: jwtPresent,
    },
    shell: {
      appPresent: !!app,
      designOsBodyActive: document.body.dataset.designOs ?? null,
      route: app?.dataset?.route ?? null,
      world: app?.dataset?.world ?? null,
      mode,
    },
    dashboard: {
      loginPresent: !!login,
      stagePresent: !!stage,
      bannerPresent: !!banner,
      tilesCount: tiles.length,
      earnPresent: !!earn,
      sponsoredRewardPresent: !!sponsored,
    },
    kade: {
      classList: kadeClassList,
      placement: (placementMatch?.[1] ?? null) as QASnapshot["kade"]["placement"],
      rectWidth: kadeRect ? Math.round(kadeRect.width) : null,
    },
    clipCards: {
      count: clipCards.length,
      firstPreviewBgIncludesKade: previewBg.includes("/brand/kade/"),
      firstPreviewBgUrl: firstBgUrl,
    },
    overlay: {
      browseOpen: browseState.open === true,
      browseUrl: browseState.currentUrl ?? null,
    },
    labels: {
      createClips: allText.includes("create clips"),
      myClips: allText.includes("my clips"),
      findRewards: allText.includes("find rewards"),
      trackEarnings: allText.includes("track earnings"),
      sponsoredReward: allText.includes("sponsored reward"),
      viaWhop: allText.includes("via whop"),
      clipperPillVisible: allText.includes("clipper"),
      agencyPillVisible: allText.includes("agency"),
    },
    atmosphere: {
      worldMounted: !!world,
      worldSceneMounted: !!worldScene,
      worldSceneBgUrl,
      worldImageLoadable,
      worldCanvasMounted: !!worldCanvas,
      consoleNavMounted: !!consoleNav,
      topHudMounted: !!topHud,
      stickyKadeMounted: !!kade,
      deckAtmospherePresent: !!deckAtmosphere,
      deckAtmosphereBgUrl,
      workstationFrameBgAlpha,
    },
    viewport: {
      simWelcomePresent: !!simWelcome,
      simH1Present: !!simH1,
      routeHeadPresent: !!routeHead,
      routeHeadHeight,
    },
    workbench: {
      splitBodyPresent: !!splitBody,
      inspectorPresent: !!inspector,
      inspectorHasClipFlag: inspector?.dataset.hasClip ?? null,
      appOverflow,
    },
    registry: {
      worldRegistryResolved,
      worldRegistryId,
      kadeRegistryResolved,
      kadeRegistryId,
      clipFallbackId,
      clipFallbackResolved,
      unresolvedCount,
    },
  };
}

async function writeReport(label: string, payload: unknown): Promise<void> {
  try {
    const fs = await import("@tauri-apps/plugin-fs");
    await fs.mkdir("qa", { baseDir: fs.BaseDirectory.AppData, recursive: true }).catch(() => {
      /* dir may already exist */
    });
    await fs.writeTextFile(`qa/${label}.json`, JSON.stringify(payload, null, 2), {
      baseDir: fs.BaseDirectory.AppData,
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(`[lcQA] writeReport(${label}) failed`, e);
  }
}

// SimulatorRouter aliases (UI-1 unification · one cockpit room). The QA
// gate accepts an alias-target as a valid match for routeMatches so
// surfaces like Schedule still verify against the canonical Workstation
// shell they fold into.
const ROUTE_ALIASES: Record<string, string> = {
  schedule: "workstation",
  engine: "workstation",
  studio: "workstation",
  export: "workstation",
  retrieve: "workstation",
  create: "home",
  import: "home",
};

function routeFamily(route: string): string {
  return ROUTE_ALIASES[route] ?? route;
}

function evalPassConditions(snap: QASnapshot, intent: SurfaceReport["intent"]): Record<string, boolean> {
  const isHome = intent.route === "home";
  const isWorkstation =
    routeFamily(intent.route) === "workstation" || intent.route === "library";
  const isBrowse = intent.openBrowse === true;
  const isClipperHome = isHome && intent.mode === "clipper";
  const isAgencyHome = isHome && intent.mode === "agency";

  const conds: Record<string, boolean> = {
    appMounted: snap.shell.appPresent,
    designOsActive: snap.shell.designOsBodyActive === "active",
    authResumed: snap.auth.hasJwt,
    noLogin: !snap.dashboard.loginPresent,
    routeMatches:
      snap.shell.route === intent.route ||
      snap.shell.route === routeFamily(intent.route),
    modeMatches: snap.shell.mode === intent.mode,
    browseOverlayState: isBrowse ? snap.overlay.browseOpen : !snap.overlay.browseOpen,
    kadeNotCenterOnHome: isHome ? snap.kade.placement !== "center" : true,
    // Kade-bg wiring lives in compiled CSS — tested via synthetic probe in
    // snapshot(), so this passes everywhere the bundle ships the rule.
    clipCardsKadeBgWired: snap.clipCards.firstPreviewBgIncludesKade,
  };

  if (isClipperHome) {
    conds.clipperHomeStage = snap.dashboard.stagePresent;
    conds.clipperHomeBanner = snap.dashboard.bannerPresent;
    conds.clipperHomeFourTiles = snap.dashboard.tilesCount === 4;
    conds.clipperHomeEarn = snap.dashboard.earnPresent;
    conds.clipperHomeSponsoredReward = snap.dashboard.sponsoredRewardPresent;
    conds.clipperHomeLabels =
      snap.labels.createClips &&
      snap.labels.myClips &&
      snap.labels.findRewards &&
      snap.labels.trackEarnings;
  }

  if (isAgencyHome) {
    conds.agencyHomeStage = snap.dashboard.stagePresent;
    conds.agencyHomeFourTiles = snap.dashboard.tilesCount === 4;
    conds.agencyHomeNoBanner = !snap.dashboard.bannerPresent; // clipper-only
    conds.agencyHomeNoEarn = !snap.dashboard.earnPresent; // clipper-only
    conds.agencyHomeNoSponsored = !snap.dashboard.sponsoredRewardPresent; // clipper-only
    conds.agencyPillVisible = snap.labels.agencyPillVisible;
  }

  if (isWorkstation) {
    conds.workstationMounted = snap.shell.appPresent;
  }

  // Atmosphere · every customer-facing surface must paint the cinematic
  // world. The previous QA passed a flat-black regression because
  // `data-world` was set on the shell while the actual WorldLayer scene
  // never loaded its webp. Every condition below is a piece of hard
  // evidence the world is visible — failing any one of them is the
  // "shell-only workstation pretending to be final" Daniel called out.
  // Stop pages and the login route legitimately skip the cockpit world,
  // so they're exempt here.
  const atmosphereRequired = intent.route !== "login" && intent.route !== "stop-pages";
  if (atmosphereRequired) {
    conds.atmosphereWorldMounted = snap.atmosphere.worldMounted;
    conds.atmosphereSceneMounted = snap.atmosphere.worldSceneMounted;
    conds.atmosphereSceneHasBg = !!snap.atmosphere.worldSceneBgUrl;
    conds.atmosphereImageLoaded = snap.atmosphere.worldImageLoadable;
    conds.atmosphereConsoleNav = snap.atmosphere.consoleNavMounted;
    conds.atmosphereTopHud = snap.atmosphere.topHudMounted;
    conds.atmosphereStickyKade = snap.atmosphere.stickyKadeMounted;
    // PRODUCT STANDARD (locked 2026-06-25): one cockpit room across every
    // route. Any drift away from cockpit-home is the "different visual
    // universes" Daniel rejected and must fail the gate.
    conds.atmosphereWorldIsCockpitHome =
      snap.shell.world === "cockpit-home" &&
      !!snap.atmosphere.worldSceneBgUrl?.includes("/brand/worlds/cockpit-home.webp");
  }
  // On routes that render the Workstation frame, fail when the frame is
  // so opaque it covers the world. <= 0.85 keeps the panel readable while
  // letting the cockpit world bleed through — that "world-behind-glass"
  // composition is the game-like feel the design lock requires.
  if (snap.atmosphere.workstationFrameBgAlpha !== null) {
    conds.workstationFrameTranslucent = snap.atmosphere.workstationFrameBgAlpha <= 0.85;
  }

  // PHASE 1 viewport discipline (locked 2026-06-25). Workstation /
  // Schedule / Earn / Campaigns must NOT render the landing-page hero
  // (sim-welcome + 80px sim-h1 + sub-copy) — it pushes the working
  // surface below the fold and makes a tool route feel like a webpage.
  // The compact .lc-route-head replaces it.
  const phase1ViewportFamily =
    routeFamily(intent.route) === "workstation" ||
    intent.route === "earn" ||
    intent.route === "campaigns";
  if (phase1ViewportFamily) {
    conds.viewportNoLandingHero = !snap.viewport.simWelcomePresent && !snap.viewport.simH1Present;
    conds.viewportRouteHeadPresent = snap.viewport.routeHeadPresent;
    conds.viewportRouteHeadCompact =
      snap.viewport.routeHeadHeight === null
        ? false
        : snap.viewport.routeHeadHeight <= 60;
  }

  // PHASE 2 split workbench (locked 2026-06-25). Only fires on the
  // Workstation family (Schedule is aliased into it). Asserts:
  //   · .lc-ws-body grid is mounted (clip column + inspector)
  //   · inspector pane is mounted (selected-clip preview lives there)
  //   · .lc-app overflow is hidden so the whole route doesn't scroll —
  //     internal columns + CockpitDock are the only things that move.
  // Workstation empty state is exempt from grid/inspector — a clean
  // session with no clips renders EngineEmptyState centered instead.
  if (routeFamily(intent.route) === "workstation") {
    conds.workbenchAppOverflowHidden = snap.workbench.appOverflow === "hidden";
    // The empty state means no grid yet — that's OK. Only require the
    // split body + inspector when there's a working session.
    if (snap.workbench.splitBodyPresent) {
      conds.workbenchInspectorMounted = snap.workbench.inspectorPresent;
    }
  }

  // STAGE B-1 registry wiring (locked 2026-06-26). Every customer
  // surface that paints the cockpit world / Kade / clip-card art must
  // resolve through the registry — no surface should be on a hardcoded
  // path. The scene-loadable check from the atmosphere block already
  // proves the cockpit-home file decodes; these add the contract that
  // it was resolved THROUGH the registry, not pasted as a string.
  if (atmosphereRequired) {
    conds.registryWorldResolved = snap.registry.worldRegistryResolved === "true";
    conds.registryWorldIsCockpitHome = snap.registry.worldRegistryId === "world.cockpit-home";
    conds.registryKadeResolved = snap.registry.kadeRegistryResolved === "true";
    // Clip-card fallback assertion only fires when a real card preview is
    // mounted (Workstation has clips, Home does not). The unresolved-count
    // assertion below still catches a card-fallback drift even when the
    // explicit check skips.
    if (snap.registry.clipFallbackResolved !== null) {
      conds.registryClipFallbackResolved = snap.registry.clipFallbackResolved === "1";
      conds.registryClipFallbackIdPresent = (snap.registry.clipFallbackId ?? "").startsWith("clip-card-fallback.");
    }
    conds.registryNoUnresolvedAssets = snap.registry.unresolvedCount === 0;
  }

  // C1 · 2026-06-26 · surface-contract assertions. Looks up the
  // SurfaceContract for this (route, mode, openBrowse) intent and lets
  // the registry add its own contract.* conditions ALONGSIDE the
  // hardcoded ones above. The hardcoded conditions stay (no behaviour
  // change to the green user-lens state); the contract layer adds
  // executable assertions that fail loudly when a future change drifts
  // away from the registered purpose / CTA / world / mode contract.
  const surfaceId = resolveSurfaceId(intent);
  if (surfaceId) {
    const contract = getSurfaceContract(surfaceId);
    if (contract) {
      const contractConds = assertSurfaceContract(
        {
          route: snap.shell.route,
          mode: snap.shell.mode,
          world: snap.shell.world,
          kadePlacement: snap.kade.placement,
          browseOpen: snap.overlay.browseOpen,
          loginPresent: snap.dashboard.loginPresent,
        },
        contract,
      );
      for (const [k, v] of Object.entries(contractConds)) {
        conds[k] = v;
      }
    }
  }

  return conds;
}

/**
 * Map a QA harness intent to a SurfaceId. Returns null when the intent
 * doesn't yet have a registered surface (the contract layer is additive,
 * so unmapped intents skip the contract block without failing the gate).
 */
function resolveSurfaceId(intent: SurfaceReport["intent"]): SurfaceId | null {
  if (intent.openBrowse) return "browse-overlay";
  switch (intent.route) {
    case "home":
      return intent.mode === "agency" ? "home.agency" : "home.clipper";
    case "create":
      return "create";
    case "workstation":
    case "library":
      return "workstation";
    case "schedule":
      return "schedule";
    case "earn":
      return "earn";
    case "campaigns":
      return intent.mode === "agency" ? "campaigns.agency" : "campaigns.clipper";
    case "community":
      return "community";
    case "settings":
      return "settings";
    case "login":
      return "login";
    default:
      return null;
  }
}

async function runVerification(): Promise<VerificationReport> {
  // Surface list mirrors Daniel's 2026-06-25 one-cockpit-room lock:
  // every surface must use the same shell, the same world, the same
  // glass language. The gate fails when any one of them drifts.
  const surfaces: SurfaceReport["intent"][] = [
    { route: "home", mode: "clipper" },
    { route: "home", mode: "agency" },
    { route: "workstation", mode: "clipper" },
    { route: "home", mode: "clipper", openBrowse: true },
    { route: "schedule", mode: "clipper" },
    { route: "earn", mode: "clipper" },
    { route: "campaigns", mode: "agency" },
  ];

  const startedAt = Date.now();
  const reports: SurfaceReport[] = [];
  let allPassed = true;

  for (let i = 0; i < surfaces.length; i++) {
    const intent = surfaces[i];
    const label = [
      "01-home-clipper",
      "02-home-agency",
      "03-workstation",
      "04-browse-overlay",
      "05-schedule",
      "06-earn",
      "07-campaigns",
    ][i];

    closeOverlay();
    await sleep(150);
    setMode(intent.mode);
    await sleep(200);
    await route(intent.route);
    await sleep(500);

    if (intent.openBrowse) {
      openOverlay("browse");
      await sleep(800);
    }

    const snap = await snapshot();
    const conditions = evalPassConditions(snap, intent);
    const passed = Object.values(conditions).every((v) => v === true);
    if (!passed) allPassed = false;

    const surface: SurfaceReport = {
      label,
      intent,
      passConditions: conditions,
      passed,
      snapshot: snap,
    };
    reports.push(surface);
    await writeReport(label, surface);
  }

  closeOverlay();

  const final: VerificationReport = {
    startedAt,
    finishedAt: Date.now(),
    allPassed,
    surfaces: reports,
  };
  await writeReport("all", final);

  // eslint-disable-next-line no-console
  console.info(`[lcQA] verification ${allPassed ? "PASSED" : "FAILED"} · wrote $APPDATA/qa/*.json`);
  return final;
}

export interface LcQASurface {
  route: (name: string) => Promise<void>;
  mode: (m: Mode) => void;
  snapshot: () => Promise<QASnapshot>;
  openOverlay: (n: "browse") => void;
  closeOverlay: () => void;
  runVerification: () => Promise<VerificationReport>;
}

declare global {
  interface Window {
    __lcQA?: LcQASurface;
  }
}

export function attachQA(): void {
  if (typeof window === "undefined") return;
  if (!qaGateEnabled()) return;
  window.__lcQA = {
    route,
    mode: setMode,
    snapshot,
    openOverlay,
    closeOverlay,
    runVerification,
  };
  // eslint-disable-next-line no-console
  console.info("[lcQA] attached · window.__lcQA ready");

  if (autoBootEnabled()) {
    // Poll for `.lc-app` to mount before starting verification. Splash +
    // AuthGate can take 6-12 seconds; we wait up to 30s. Without this the
    // snapshot fires while the splash/intro is still up and every surface
    // reports `appPresent=false`.
    const start = Date.now();
    const poll = () => {
      const ready = !!document.querySelector(".lc-app");
      if (ready) {
        // One extra frame so route + world data-attrs settle.
        setTimeout(() => {
          void runVerification().then((r) => {
            // eslint-disable-next-line no-console
            console.info("[lcQA] autoboot complete", r.allPassed ? "PASS" : "FAIL");
          });
        }, 600);
        return;
      }
      if (Date.now() - start > 30_000) {
        // eslint-disable-next-line no-console
        console.warn("[lcQA] autoboot timed out waiting for .lc-app");
        void runVerification();
        return;
      }
      setTimeout(poll, 250);
    };
    poll();
  }
}
