const puppeteer = require("puppeteer-core");
const fs = require("fs");
const path = require("path");

const OUT_DIR = path.join(__dirname, "..", "ui-review", "brand-fidelity");
const BASE_URL = "http://localhost:1420";

const SHOTS = [
  { name: "home", route: "#/home", nav: "Home" },
  { name: "campaigns", route: "#/campaigns", nav: "Campaigns" },
  { name: "clipper", route: "#/clipper", nav: null },
  { name: "earn", route: "#/earn", nav: "Earn" },
  { name: "settings", route: "#/settings", nav: "Settings" },
  { name: "engine", route: "#/editor", nav: "Engine" },
];

const EXECUTABLE_PATH =
  process.env.PUPPETEER_EXECUTABLE_PATH ||
  "/Users/dipdip/.cache/puppeteer/chrome-headless-shell/mac-149.0.7827.22/chrome-headless-shell-mac-x64/chrome-headless-shell";

async function navigateTo(page, shot) {
  if (shot.name === "home") {
    await page.goto(`${BASE_URL}/${shot.route}`, { waitUntil: "domcontentloaded", timeout: 30000 });
    return;
  }

  if (shot.nav) {
    await page.evaluate((label) => {
      const buttons = Array.from(document.querySelectorAll("nav button"));
      const btn = buttons.find((b) => b.textContent.trim() === label);
      btn?.click();
    }, shot.nav);
    return;
  }

  // Hidden routes: mutate hash after the app is mounted.
  await page.evaluate((route) => {
    window.location.hash = route;
  }, shot.route);
}

async function main() {
  if (!fs.existsSync(OUT_DIR)) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
  }

  const browser = await puppeteer.launch({
    executablePath: EXECUTABLE_PATH,
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--window-size=1280,832"],
    defaultViewport: { width: 1280, height: 832 },
  });

  const page = await browser.newPage();

  for (const shot of SHOTS) {
    console.log(`Capturing ${shot.name}...`);
    try {
      await navigateTo(page, shot);
      await new Promise((r) => setTimeout(r, 2500));
      const outPath = path.join(OUT_DIR, `${shot.name}.png`);
      await page.screenshot({ path: outPath, fullPage: false });
      console.log(`  saved ${outPath}`);
    } catch (err) {
      console.error(`  failed ${shot.name}: ${err.message}`);
    }
  }

  await browser.close();
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
