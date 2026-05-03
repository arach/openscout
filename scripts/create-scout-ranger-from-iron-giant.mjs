import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sharpModulePath = path.join(root, "landing/node_modules/sharp/lib/index.js");
const { default: sharp } = await import(sharpModulePath);

const source = path.join(root, "tmp/codex-pets/iron-giant/spritesheet.webp");
const outDir = path.join(root, "tmp/codex-pets/scout-ranger");
const cellWidth = 192;
const cellHeight = 208;
const columns = 8;
const rows = 9;
const rowFrameCounts = [6, 8, 8, 4, 5, 8, 6, 6, 6];

await mkdir(outDir, { recursive: true });

function capSvg(width, height) {
  return Buffer.from(`
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
    <feDropShadow dx="0" dy="2" stdDeviation="1.2" flood-color="#10140d" flood-opacity="0.55"/>
  </filter>
  <g filter="url(#shadow)">
    <path d="M18 27 Q${width / 2} 3 ${width - 18} 27 L${width - 28} 41 Q${width / 2} 29 28 41 Z" fill="#26391f" stroke="#11180f" stroke-width="4" stroke-linejoin="round"/>
    <path d="M26 27 Q${width / 2} 14 ${width - 26} 27" fill="none" stroke="#6f8c43" stroke-width="6" stroke-linecap="round"/>
    <path d="M45 41 Q${width / 2} 50 ${width - 45} 41" fill="none" stroke="#11180f" stroke-width="5" stroke-linecap="round"/>
    <circle cx="${width / 2}" cy="28" r="10" fill="#f4c95d" stroke="#ffe9a3" stroke-width="2"/>
    <path d="M${width / 2 - 6} 29 l5 -8 l4 8 l8 1 l-6 5 l2 8 l-7 -4 l-7 4 l2 -8 l-6 -5 z" fill="#fff4b0"/>
  </g>
</svg>`);
}

function badgeSvg(size) {
  return Buffer.from(`
<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
  <g opacity="0.96">
    <circle cx="${size / 2}" cy="${size / 2}" r="${size * 0.32}" fill="#f4c95d" stroke="#fff1a8" stroke-width="2"/>
    <path d="M${size * 0.33} ${size * 0.54} l${size * 0.12} -${size * 0.19} l${size * 0.1} ${size * 0.18} l${size * 0.22} -${size * 0.28}" fill="none" stroke="#30451f" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
</svg>`);
}

async function cellBounds(row, column) {
  const image = sharp(source).extract({
    left: column * cellWidth,
    top: row * cellHeight,
    width: cellWidth,
    height: cellHeight,
  });
  const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let minX = info.width;
  let minY = info.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const alpha = data[(y * info.width + x) * 4 + 3];
      if (alpha > 16) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }
  if (maxX < 0) return null;
  return { minX, minY, maxX, maxY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

const composites = [];

for (let row = 0; row < rows; row += 1) {
  for (let column = 0; column < rowFrameCounts[row]; column += 1) {
    const bounds = await cellBounds(row, column);
    if (!bounds) continue;
    const centerX = column * cellWidth + bounds.minX + bounds.width / 2;
    const capWidth = Math.min(78, Math.max(54, bounds.width * 0.55));
    const capHeight = 46;
    const capTop = row * cellHeight + Math.max(0, bounds.minY - capHeight * 0.48);
    composites.push({
      input: capSvg(capWidth, capHeight),
      left: Math.round(centerX - capWidth / 2),
      top: Math.round(capTop),
    });

    const badgeSize = Math.min(28, Math.max(18, bounds.width * 0.18));
    composites.push({
      input: badgeSvg(badgeSize),
      left: Math.round(column * cellWidth + bounds.minX + bounds.width * 0.48 - badgeSize / 2),
      top: Math.round(row * cellHeight + bounds.minY + bounds.height * 0.48),
    });
  }
}

await sharp(source)
  .composite(composites)
  .webp({ quality: 95, lossless: true })
  .toFile(path.join(outDir, "spritesheet.webp"));

await sharp(path.join(outDir, "spritesheet.webp"))
  .flatten({ background: "#ffffff" })
  .png()
  .toFile(path.join(outDir, "contact-sheet.png"));

await writeFile(
  path.join(outDir, "pet.json"),
  `${JSON.stringify(
    {
      id: "scout-ranger",
      displayName: "Scout Ranger",
      description: "A tiny chunky robot field-general companion for Scout and Codex sessions.",
      spritesheetPath: "spritesheet.webp",
    },
    null,
    2,
  )}\n`,
);

console.log(outDir);
