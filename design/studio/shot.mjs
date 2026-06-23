// Quick studio screenshot helper for fast design iteration.
//   node shot.mjs <slug> [skin] [width]
// e.g. node shot.mjs tail-treatments juniper-d 1180
import puppeteer from "/Users/arach/node_modules/puppeteer/lib/esm/puppeteer/puppeteer.js";

const slug = process.argv[2] || "tail-treatments";
const skin = process.argv[3] || "juniper-d";
const width = Number(process.argv[4] || 1180);
const out = `/tmp/studio-${slug}-${skin}.png`;
const url = `http://localhost:3030/studies/${slug}?skin=${skin}`;

const browser = await puppeteer.launch({
  executablePath:
    "/Users/arach/.cache/puppeteer/chrome/mac_arm-148.0.7778.97/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
  headless: "new",
  args: ["--no-sandbox", "--force-color-profile=srgb"],
});
const page = await browser.newPage();
await page.setViewport({ width, height: 900, deviceScaleFactor: 2 });
await page.goto(url, { waitUntil: "networkidle0", timeout: 60000 });
await new Promise((r) => setTimeout(r, 700));
await page.screenshot({ path: out, fullPage: true });
await browser.close();
console.log(out);
