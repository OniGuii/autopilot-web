import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.WEB_BASE_URL || "http://localhost:3000";
const OUT = path.resolve("/workspace/docs/ui-showcase/screenshots");
const EMAIL = "owner@local.autopilot.dev";
const PASSWORD = "Demo@12345";

const LEAD = process.env.LEAD_ID || "923a0ce1-adfc-4cf7-b3c5-4644a4c3e754";
const CONV = process.env.CONV_ID || "756ebb7f-8bd4-4df0-a1bf-5c36bb211bc7";
const FU = process.env.FU_ID || "65b1a866-f7be-41cc-8e75-9b510f3f6f85";

fs.mkdirSync(OUT, { recursive: true });

const routes = [
  { id: "login", path: "/login", auth: false },
  { id: "select-company", path: "/select-company", auth: true, skipAutoCompany: true },
  { id: "dashboard", path: "/dashboard", auth: true },
  { id: "leads", path: "/leads", auth: true },
  { id: "lead-detail", path: `/leads/${LEAD}`, auth: true },
  { id: "conversations", path: "/conversations", auth: true },
  { id: "conversation-detail", path: `/conversations/${CONV}`, auth: true },
  { id: "follow-ups", path: "/follow-ups", auth: true },
  { id: "follow-up-detail", path: `/follow-ups/${FU}`, auth: true },
  { id: "whatsapp", path: "/whatsapp", auth: true },
  { id: "pipeline", path: "/pipeline", auth: true },
  { id: "team", path: "/team", auth: true },
  { id: "users", path: "/users", auth: true },
  { id: "settings", path: "/settings", auth: true },
  { id: "exports", path: "/exports", auth: true },
  { id: "diagnostics", path: "/diagnostics", auth: true },
  { id: "setup", path: "/setup", auth: true },
  { id: "logout", path: "/logout", auth: true },
];

async function login(page, { selectCompany = true } = {}) {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  // Clear any stuck session via localStorage
  await page.evaluate(() => {
    localStorage.clear();
    document.cookie.split(";").forEach((c) => {
      const n = c.split("=")[0]?.trim();
      if (n) document.cookie = `${n}=; Max-Age=0; path=/`;
    });
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(500);

  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await page.click('button[type="submit"]');

  // Wait for navigation away from login (dashboard or select-company)
  await page.waitForURL((url) => !url.pathname.includes("/login"), {
    timeout: 20000,
  });
  await page.waitForTimeout(1200);

  if (!selectCompany && page.url().includes("/dashboard")) {
    // already auto-selected; for select-company screenshot we need pre-select state
  }
}

async function shot(page, name, viewport) {
  const file = path.join(OUT, `${name}-${viewport}.png`);
  await page.waitForTimeout(600);
  await page.screenshot({ path: file, fullPage: true });
  return file;
}

async function captureViewport(viewportName, size) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: size,
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const notes = [];

  // Public login (logged out)
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await shot(page, "01-login", viewportName);
  notes.push({
    id: "login",
    viewport: viewportName,
    url: page.url(),
    title: await page.title(),
    text: (await page.locator("body").innerText()).slice(0, 400),
  });

  // Login as owner
  await login(page, { selectCompany: true });

  // If landed on select-company (multi membership), pick first
  if (page.url().includes("/select-company")) {
    await shot(page, "02-select-company", viewportName);
    notes.push({
      id: "select-company",
      viewport: viewportName,
      url: page.url(),
      text: (await page.locator("body").innerText()).slice(0, 400),
    });
    const btn = page.getByRole("button", { name: /Entrar|Abrindo/i }).first();
    if (await btn.count()) {
      await btn.click();
      await page.waitForURL("**/dashboard**", { timeout: 15000 });
    }
  } else {
    // Capture select-company by clearing company cookie and forcing path
    // Owner with 1 membership auto-selects; navigate still for completeness after logout/login without auto
    // We'll screenshot select-company by going there if accessible
    await page.goto(`${BASE}/select-company`, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    await shot(page, "02-select-company", viewportName);
    notes.push({
      id: "select-company",
      viewport: viewportName,
      url: page.url(),
      text: (await page.locator("body").innerText()).slice(0, 400),
    });
    if (!page.url().includes("/select-company")) {
      // redirected away — ok
    } else {
      await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
    }
  }

  const authed = [
    ["03-dashboard", "/dashboard"],
    ["04-leads", "/leads"],
    ["05-lead-detail", `/leads/${LEAD}`],
    ["06-conversations", "/conversations"],
    ["07-conversation-detail", `/conversations/${CONV}`],
    ["08-follow-ups", "/follow-ups"],
    ["09-follow-up-detail", `/follow-ups/${FU}`],
    ["10-whatsapp", "/whatsapp"],
    ["11-pipeline", "/pipeline"],
    ["12-team", "/team"],
    ["13-users", "/users"],
    ["14-settings", "/settings"],
    ["15-exports", "/exports"],
    ["16-diagnostics", "/diagnostics"],
    ["17-setup", "/setup"],
  ];

  for (const [name, route] of authed) {
    try {
      await page.goto(`${BASE}${route}`, { waitUntil: "networkidle", timeout: 30000 });
      await page.waitForTimeout(900);
      // open mobile menu once for mobile shell evidence
      if (viewportName === "mobile" && name === "03-dashboard") {
        const menu = page.getByRole("button", { name: /Abrir menu/i });
        if (await menu.count()) {
          await menu.click();
          await page.waitForTimeout(400);
          await shot(page, "03b-dashboard-mobile-menu", viewportName);
          // close overlay
          await page.keyboard.press("Escape").catch(() => {});
          const close = page.getByRole("button", { name: /Fechar menu/i });
          if (await close.count()) await close.first().click().catch(() => {});
          await page.waitForTimeout(300);
        }
      }
      await shot(page, name, viewportName);
      notes.push({
        id: name,
        viewport: viewportName,
        url: page.url(),
        text: (await page.locator("body").innerText()).slice(0, 500),
      });
    } catch (err) {
      notes.push({
        id: name,
        viewport: viewportName,
        error: String(err),
      });
      await shot(page, `${name}-error`, viewportName).catch(() => {});
    }
  }

  // logout page
  try {
    await page.goto(`${BASE}/logout`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1000);
    await shot(page, "18-logout", viewportName);
    notes.push({
      id: "logout",
      viewport: viewportName,
      url: page.url(),
      text: (await page.locator("body").innerText()).slice(0, 300),
    });
  } catch (err) {
    notes.push({ id: "logout", viewport: viewportName, error: String(err) });
  }

  await browser.close();
  return notes;
}

const allNotes = [];
allNotes.push(
  ...(await captureViewport("desktop", { width: 1440, height: 900 })),
);
allNotes.push(
  ...(await captureViewport("mobile", { width: 390, height: 844 })),
);

fs.writeFileSync(
  path.join(OUT, "capture-notes.json"),
  JSON.stringify(allNotes, null, 2),
);
console.log("Wrote screenshots to", OUT);
console.log("Count:", fs.readdirSync(OUT).filter((f) => f.endsWith(".png")).length);
