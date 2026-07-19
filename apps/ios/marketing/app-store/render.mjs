import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "../../../../landing/openscout.app/node_modules/sharp/lib/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../..");
const outputDir = path.join(here, "iphone-69");
const homePath = path.join(root, "landing/openscout.app/public/scout/ios-home.png");
const threadPath = path.join(root, "landing/openscout.app/public/scout/ios-thread.png");
const iconPath = path.join(root, "assets/icons/app/os-iOS-Default-1024x1024@1x.png");

const WIDTH = 1320;
const HEIGHT = 2868;
const INK = "#f4f2ea";
const MUTED = "#aaa9a3";
const ACCENT = "#16c997";
const MONO = "SFMono-Regular, Menlo, monospace";
const UI = "SF Pro Display, Helvetica Neue, Arial, sans-serif";

const escapeXml = (value) => value
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;");

function backdrop({ eyebrow, headline, subtitle, number }) {
  const lines = headline.split("\n");
  const headlineSvg = lines.map((line, index) => (
    `<tspan x="92" dy="${index === 0 ? 0 : 108}">${escapeXml(line)}</tspan>`
  )).join("");

  return `
    <svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#17140f"/>
          <stop offset="0.38" stop-color="#0b0c0b"/>
          <stop offset="1" stop-color="#040505"/>
        </linearGradient>
        <radialGradient id="glow" cx="76%" cy="7%" r="62%">
          <stop offset="0" stop-color="#19483b" stop-opacity="0.82"/>
          <stop offset="0.42" stop-color="#0d2a23" stop-opacity="0.28"/>
          <stop offset="1" stop-color="#07110e" stop-opacity="0"/>
        </radialGradient>
        <linearGradient id="wire" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#fff9ea" stop-opacity="0.28"/>
          <stop offset="1" stop-color="#16c997" stop-opacity="0.02"/>
        </linearGradient>
        <filter id="shadow" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="34"/>
        </filter>
      </defs>
      <rect width="1320" height="2868" fill="url(#bg)"/>
      <rect width="1320" height="2868" fill="url(#glow)"/>
      <ellipse cx="660" cy="2520" rx="520" ry="150" fill="#000" opacity="0.72" filter="url(#shadow)"/>
      <g fill="none" stroke="url(#wire)" stroke-width="2">
        <path d="M916 22 1242 210 1242 586 916 774 590 586 590 210Z"/>
        <path d="M916 200 1088 300 1088 498 916 598 744 498 744 300Z"/>
        <path d="M916 22V774M590 210l652 376M1242 210 590 586"/>
      </g>
      <text x="92" y="130" fill="${ACCENT}" font-family="${MONO}" font-size="25" font-weight="600" letter-spacing="7">${escapeXml(eyebrow.toUpperCase())}</text>
      <text x="1228" y="130" text-anchor="end" fill="#8f8d85" font-family="${MONO}" font-size="22" letter-spacing="4">${number}</text>
      <text x="92" y="300" fill="${INK}" font-family="${UI}" font-size="92" font-weight="700" letter-spacing="-3">${headlineSvg}</text>
      <text x="96" y="${lines.length > 1 ? 580 : 478}" fill="${MUTED}" font-family="${UI}" font-size="34" font-weight="400">${escapeXml(subtitle)}</text>
    </svg>`;
}

function roundedMask(width, height, radius) {
  return Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect width="${width}" height="${height}" rx="${radius}" fill="#fff"/></svg>`);
}

async function roundedImage(input, width, height, radius, extract) {
  let image = sharp(input);
  if (extract) image = image.extract(extract);
  return image
    .resize(width, height, { fit: "cover", position: "top" })
    .composite([{ input: roundedMask(width, height, radius), blend: "dest-in" }])
    .png()
    .toBuffer();
}

function phoneChrome(x, y, width, height, radius = 92) {
  return Buffer.from(`
    <svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="phoneShadow" x="-30%" y="-20%" width="160%" height="160%">
          <feDropShadow dx="0" dy="34" stdDeviation="42" flood-color="#000" flood-opacity="0.82"/>
        </filter>
        <linearGradient id="rim" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#80796d"/>
          <stop offset="0.28" stop-color="#242522"/>
          <stop offset="0.72" stop-color="#111312"/>
          <stop offset="1" stop-color="#6f6c63"/>
        </linearGradient>
      </defs>
      <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}" fill="url(#rim)" filter="url(#phoneShadow)"/>
      <rect x="${x + 8}" y="${y + 8}" width="${width - 16}" height="${height - 16}" rx="${radius - 8}" fill="#020303"/>
    </svg>`);
}

async function renderPhoneSlide({ filename, eyebrow, headline, subtitle, number, screenshot, crop = null }) {
  const frame = { x: 154, y: 744, width: 1012, height: 2288, radius: 96 };
  const screen = { x: frame.x + 18, y: frame.y + 18, width: frame.width - 36, height: frame.height - 36, radius: 79 };
  const screenImage = await roundedImage(screenshot, screen.width, screen.height, screen.radius, crop);
  const canvas = sharp(Buffer.from(backdrop({ eyebrow, headline, subtitle, number })));
  await canvas
    .composite([
      { input: phoneChrome(frame.x, frame.y, frame.width, frame.height, frame.radius), left: 0, top: 0 },
      { input: screenImage, left: screen.x, top: screen.y },
    ])
    .png()
    .toFile(path.join(outputDir, filename));
}

async function renderDetailsSlide() {
  const header = Buffer.from(backdrop({
    eyebrow: "Scout for iPhone",
    headline: "Every project.\nOne calm view.",
    subtitle: "See active agents and recent work without changing tools.",
    number: "03",
  }));
  const projects = await roundedImage(homePath, 1120, 760, 54, { left: 0, top: 420, width: 1206, height: 900 });
  const activity = await roundedImage(homePath, 1120, 980, 54, { left: 0, top: 1100, width: 1206, height: 1120 });
  const labels = Buffer.from(`
    <svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <defs><filter id="s"><feDropShadow dx="0" dy="24" stdDeviation="28" flood-color="#000" flood-opacity="0.8"/></filter></defs>
      <rect x="72" y="770" width="1176" height="820" rx="62" fill="#111311" stroke="#34372f" stroke-width="2" filter="url(#s)"/>
      <rect x="72" y="1720" width="1176" height="1040" rx="62" fill="#111311" stroke="#34372f" stroke-width="2" filter="url(#s)"/>
      <text x="108" y="742" fill="${ACCENT}" font-family="${MONO}" font-size="24" font-weight="600" letter-spacing="5">PROJECTS</text>
      <text x="108" y="1692" fill="${ACCENT}" font-family="${MONO}" font-size="24" font-weight="600" letter-spacing="5">LATEST ACTIVITY</text>
    </svg>`);
  await sharp(header)
    .composite([
      { input: labels, left: 0, top: 0 },
      { input: projects, left: 100, top: 800 },
      { input: activity, left: 100, top: 1750 },
    ])
    .png()
    .toFile(path.join(outputDir, "03-one-calm-view.png"));
}

async function renderTrustSlide() {
  const header = Buffer.from(backdrop({
    eyebrow: "Scout for iPhone",
    headline: "Local-first.\nHuman-controlled.",
    subtitle: "Pair with your Mac and keep the operator in the loop.",
    number: "04",
  }));
  const icon = await sharp(iconPath).resize(330, 330).png().toBuffer();
  const status = await roundedImage(homePath, 1100, 330, 46, { left: 0, top: 2290, width: 1206, height: 332 });
  const composer = await roundedImage(threadPath, 1100, 760, 54, { left: 0, top: 1580, width: 1125, height: 780 });
  const diagram = Buffer.from(`
    <svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <defs><filter id="s"><feDropShadow dx="0" dy="24" stdDeviation="28" flood-color="#000" flood-opacity="0.82"/></filter></defs>
      <rect x="80" y="760" width="1160" height="620" rx="70" fill="#111311" stroke="#34372f" stroke-width="2" filter="url(#s)"/>
      <text x="118" y="828" fill="${MUTED}" font-family="${MONO}" font-size="22" letter-spacing="4">PAIR ONCE</text>
      <text x="118" y="890" fill="${INK}" font-family="${UI}" font-size="43" font-weight="650">Your Mac</text>
      <text x="1202" y="890" text-anchor="end" fill="${INK}" font-family="${UI}" font-size="43" font-weight="650">Your iPhone</text>
      <path d="M342 1010H514" stroke="#62635e" stroke-width="3"/>
      <path d="M806 1010H978" stroke="#62635e" stroke-width="3"/>
      <circle cx="660" cy="1010" r="114" fill="#0c1612" stroke="${ACCENT}" stroke-width="3"/>
      <text x="660" y="1000" text-anchor="middle" fill="${ACCENT}" font-family="${MONO}" font-size="22" letter-spacing="3">LAN</text>
      <text x="660" y="1038" text-anchor="middle" fill="${MUTED}" font-family="${MONO}" font-size="18" letter-spacing="2">TSN · OSN</text>
      <circle cx="298" cy="1010" r="12" fill="${ACCENT}"/>
      <circle cx="1022" cy="1010" r="12" fill="${ACCENT}"/>
      <text x="120" y="1486" fill="${ACCENT}" font-family="${MONO}" font-size="24" font-weight="600" letter-spacing="5">LIVE CONNECTION STATE</text>
      <text x="120" y="2034" fill="${ACCENT}" font-family="${MONO}" font-size="24" font-weight="600" letter-spacing="5">READ · REPLY · DICTATE</text>
    </svg>`);
  await sharp(header)
    .composite([
      { input: diagram, left: 0, top: 0 },
      { input: icon, left: 495, top: 1120 },
      { input: status, left: 110, top: 1530 },
      { input: composer, left: 110, top: 2080 },
    ])
    .png()
    .toFile(path.join(outputDir, "04-local-first.png"));
}

await mkdir(outputDir, { recursive: true });

await renderPhoneSlide({
  filename: "01-agents-in-your-pocket.png",
  eyebrow: "Scout for iPhone",
  headline: "Your agents.\nIn your pocket.",
  subtitle: "Coordinate Claude Code, Codex, and more from one cockpit.",
  number: "01",
  screenshot: homePath,
});

await renderPhoneSlide({
  filename: "02-read-and-reply.png",
  eyebrow: "Scout for iPhone",
  headline: "Read progress.\nReply from anywhere.",
  subtitle: "Follow the work, ask a question, or dictate a response.",
  number: "02",
  screenshot: threadPath,
});

await renderDetailsSlide();
await renderTrustSlide();

console.log(`Rendered four App Store creatives to ${outputDir}`);
