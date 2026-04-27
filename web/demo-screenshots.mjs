import { chromium } from "playwright";

const BROWSER_PATH =
  process.env.HOME +
  "/Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({
    executablePath: BROWSER_PATH,
    headless: true,
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto("http://localhost:5174", { waitUntil: "networkidle" });
  await sleep(4000);

  const canvas = await page.$("canvas");
  const box = await canvas.boundingBox();
  const midX = box.x + box.width / 2;
  const midY = box.y + box.height / 2;

  async function getPanelTitle() {
    const h2 = await page.$("h2.text-star");
    return h2 ? h2.textContent() : null;
  }

  // Zoom in so books are visible
  await page.mouse.move(midX, midY);
  for (let i = 0; i < 11; i++) {
    await page.mouse.wheel(0, -120);
    await sleep(80);
  }
  await sleep(2000);

  // Helper: find a book in a screen region
  async function findBookInRegion(xMin, xMax, yMin, yMax) {
    const pts = [];
    for (let x = xMin; x <= xMax; x += 28)
      for (let y = yMin; y <= yMax; y += 22)
        pts.push([x, y]);
    pts.sort(() => Math.random() - 0.5);
    for (const [px, py] of pts) {
      if (px < box.x || px > box.x + box.width || py < box.y || py > box.y + box.height) continue;
      await page.mouse.click(px, py);
      await sleep(300);
      const t = await getPanelTitle();
      if (t) return { title: t, x: px, y: py };
    }
    return null;
  }

  // Helper: deselect current book
  async function deselectAt(x, y) {
    await page.mouse.click(x, y);
    await sleep(400);
  }

  // ── Screenshot 1: Book in top-left → panel to the right of it ──
  console.log("Looking for book in top-left...");
  const tlBook = await findBookInRegion(
    box.x + 30, midX - 80,
    box.y + 30, midY - 80
  );

  if (tlBook) {
    console.log(`Top-left: "${tlBook.title.slice(0, 50)}" at (${tlBook.x}, ${tlBook.y})`);
    await sleep(500);
    await page.screenshot({ path: "demo-1-topleft.png" });
    console.log("Screenshot 1 saved: panel right of book in top-left");
    await deselectAt(tlBook.x, tlBook.y);
  } else {
    console.log("No book in top-left");
  }

  // ── Screenshot 2: Book in top-right → panel to the left of it ──
  console.log("Looking for book in top-right...");
  const trBook = await findBookInRegion(
    midX + 80, box.x + box.width - 30,
    box.y + 30, midY - 80
  );

  if (trBook) {
    console.log(`Top-right: "${trBook.title.slice(0, 50)}" at (${trBook.x}, ${trBook.y})`);
    await sleep(500);
    await page.screenshot({ path: "demo-2-topright.png" });
    console.log("Screenshot 2 saved: panel left of book in top-right");
    await deselectAt(trBook.x, trBook.y);
  } else {
    console.log("No book in top-right");
  }

  // ── Screenshot 3: Book near center → panel defaults to right ──
  console.log("Looking for book near center...");
  const cBook = await findBookInRegion(
    midX - 100, midX + 30,
    midY - 100, midY + 100
  );

  if (cBook) {
    console.log(`Center: "${cBook.title.slice(0, 50)}" at (${cBook.x}, ${cBook.y})`);
    await sleep(500);
    await page.screenshot({ path: "demo-3-center.png" });
    console.log("Screenshot 3 saved: panel right of center book");
    await deselectAt(cBook.x, cBook.y);
  } else {
    console.log("No book near center");
  }

  // ── Screenshot 4: Selected book with no duplicate tooltip ──
  // Select a book and then hover directly over it to verify no tooltip
  console.log("Verifying no tooltip on selected book...");
  const anyBook = tlBook || trBook || cBook;
  if (anyBook) {
    await page.mouse.click(anyBook.x, anyBook.y);
    await sleep(400);
    // Move mouse slightly away then back onto the book to trigger hover
    await page.mouse.move(anyBook.x + 5, anyBook.y + 5);
    await sleep(200);
    await page.mouse.move(anyBook.x, anyBook.y);
    await sleep(300);

    // Check: tooltip element should be hidden
    const tipDisplay = await page.evaluate(() => {
      const tip = document.querySelector('[class*="tooltip"]') ||
        document.querySelector('.absolute.pointer-events-none.z-20');
      return tip ? getComputedStyle(tip).display : "not-found";
    });
    console.log(`Tooltip display on selected book: "${tipDisplay}"`);

    await page.screenshot({ path: "demo-4-no-tooltip.png" });
    console.log("Screenshot 4 saved: selected book with no duplicate label");
  }

  await browser.close();
  console.log("Done!");
})();
