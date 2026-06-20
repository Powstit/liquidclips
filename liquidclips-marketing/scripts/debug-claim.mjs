import puppeteer from "puppeteer-core";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL = "http://localhost:1420/?session=ixwod2x&api=http://localhost:3000&skipIntro=1";
const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", defaultViewport: { width: 1440, height: 900 } });
const page = await browser.newPage();
const errors = []; const logs = [];
page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => errors.push(`ERROR ${e.message}`));
page.on("requestfailed", (r) => errors.push(`REQFAIL ${r.url()} ${r.failure()?.errorText}`));
await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 30000 });
await new Promise((r) => setTimeout(r, 5000));
const state = await page.evaluate(() => {
  return {
    href: location.href,
    search: location.search,
    hash: location.hash,
    lsSession: localStorage.getItem("lc.funnel.session.v1"),
    lsJwt: localStorage.getItem("lc.license.jwt.v1") ? "yes" : "no",
    hasClaimScreen: !!document.querySelector(".lc-claim-screen"),
    hasAppShell: !!document.querySelector(".lc-app"),
    hasLogin: document.body.innerText.includes("Already activated") || document.body.innerText.includes("Sign in"),
    visibleH1: document.querySelector("h1")?.textContent ?? null,
  };
});
console.log("STATE:", JSON.stringify(state, null, 2));
if (logs.length) console.log("CONSOLE:\n" + logs.slice(0,20).join("\n"));
if (errors.length) console.log("ERRORS:\n" + errors.slice(0,10).join("\n"));
await browser.close();
