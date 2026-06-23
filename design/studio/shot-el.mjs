// Tight element crop for fast design review.
//   node shot-el.mjs <slug> <classSubstr> <index> [skin] [width]
import puppeteer from "/Users/arach/node_modules/puppeteer/lib/esm/puppeteer/puppeteer.js";

const slug = process.argv[2] || "tail-treatments";
const sub = process.argv[3] || "surface";
const idx = Number(process.argv[4] || 0);
const skin = process.argv[5] || "juniper-d";
const width = Number(process.argv[6] || 980);
const out = `/tmp/studio-${slug}-${sub}-${idx}.png`;
const url = `http://localhost:3030/studies/${slug}?skin=${skin}`;

const browser = await puppeteer.launch({
  executablePath:
    "/Users/arach/.cache/puppeteer/chrome/mac_arm-148.0.7778.97/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
  headless: "new",
  args: ["--no-sandbox", "--force-color-profile=srgb"],
});
const page = await browser.newPage();
await page.setViewport({ width, height: 900, deviceScaleFactor: 3 });
await page.goto(url, { waitUntil: "networkidle0", timeout: 60000 });
await new Promise((r) => setTimeout(r, 700));
const els = await page.$$(`[class*="${sub}"]`);
if (!els[idx]) {
  console.error(`no element [class*="${sub}"] at index ${idx} (found ${els.length})`);
  await browser.close();
  process.exit(1);
}
await els[idx].screenshot({ path: out });
await browser.close();
console.log(out);
