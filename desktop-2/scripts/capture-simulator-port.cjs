const puppeteer = require("puppeteer-core");
const path = require("path");
const fs = require("fs");

const BASE_URL = "http://localhost:1420";
const OUT_DIR = path.join(__dirname, "..", "ui-review", "lc2-simulator-port");
const SHELL_PATH =
  "/Users/dipdip/.cache/puppeteer/chrome-headless-shell/mac-149.0.7827.22/chrome-headless-shell-mac-x64/chrome-headless-shell";

const SHOTS = [
  { name: "home", route: "#/home", wait: 2500 },
  { name: "create", nav: "Create", wait: 2500 },
  { name: "browse", nav: "Browse", wait: 2500 },
  { name: "engine", nav: "Engine", wait: 2500 },
  { name: "campaigns", nav: "Campaigns", wait: 2500 },
  { name: "clipper", route: "#/clipper", wait: 2500 },
  { name: "earn", nav: "Earn", wait: 2500 },
  { name: "settings", nav: "Settings", wait: 2500 },
];

async function main() {
  if (!fs.existsSync(SHELL_PATH)) {
    console.error("Chrome headless shell not found at", SHELL_PATH);
    process.exit(1);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: SHELL_PATH,
    headless: true,
    defaultViewport: { width: 1280, height: 832 },
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();

  await page.goto(`${BASE_URL}/#/home`, { waitUntil: "domcontentloaded" });
  await new Promise((r) => setTimeout(r, 2500));
  await page.screenshot({ path: path.join(OUT_DIR, "home.png") });

  for (const shot of SHOTS.slice(1)) {
    if (shot.nav) {
      await page.evaluate((label) => {
        const btn = Array.from(document.querySelectorAll("nav button, aside button"))
          .find((b) => b.textContent.trim() === label);
        btn?.click();
      }, shot.nav);
    } else {
      await page.evaluate((route) => { window.location.hash = route; }, shot.route);
    }
    await new Promise((r) => setTimeout(r, shot.wait));
    await page.screenshot({ path: path.join(OUT_DIR, `${shot.name}.png`) });
  }

  await browser.close();
  console.log("Screenshots saved to", OUT_DIR);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
