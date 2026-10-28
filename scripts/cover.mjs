// Generates cover.png (800x534) for gladys-resol: plain Node, no dependency.
// (The drawing helpers of gladys-openems.) A sun over a solar thermal
// collector, its pipes down to a hot water tank with a coil, a pump, a
// controller with its display and a thermometer, local network waves (no
// cloud), on a warm orange-to-red gradient (no brand logo).
// Usage: node scripts/cover.mjs cover.png
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const W = 800;
const H = 534;
const px = Buffer.alloc(W * H * 3);
const set = (x, y, [r, g, b], a = 1) => {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3;
  px[i] = px[i] * (1 - a) + r * a;
  px[i + 1] = px[i + 1] * (1 - a) + g * a;
  px[i + 2] = px[i + 2] * (1 - a) + b * a;
};
for (let y = 0; y < H; y += 1) {
  for (let x = 0; x < W; x += 1) {
    const t = (x / W + y / H) / 2;
    set(x, y, [240 - 40 * t, 150 - 90 * t, 60 + 20 * t]);
  }
}
const white = [255, 255, 255];
const dark = [30, 36, 60];
const orange = [255, 200, 70];
const red = [220, 60, 50];
const hot = [250, 120, 60];
const blue = [90, 170, 240];
const glass = [190, 215, 240];
const disc = (cx, cy, r, color, alpha = 1) => {
  for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y += 1) {
    for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x += 1) {
      const a = Math.max(0, Math.min(1, r - Math.hypot(x - cx, y - cy) + 0.5));
      if (a > 0) set(x, y, color, a * alpha);
    }
  }
};
// An arc of a ring, between two angles (radians, 0 = right, clockwise on screen).
const arc = (cx, cy, r, width, from, to, color) => {
  for (let y = Math.floor(cy - r - width); y <= cy + r + width; y += 1) {
    for (let x = Math.floor(cx - r - width); x <= cx + r + width; x += 1) {
      const angle = Math.atan2(y - cy, x - cx);
      if (angle < from || angle > to) continue;
      const a = Math.max(
        0,
        Math.min(1, width / 2 - Math.abs(Math.hypot(x - cx, y - cy) - r) + 0.5),
      );
      if (a > 0) set(x, y, color, a);
    }
  }
};
// Rounded rectangle, anti-aliased corners.
const box = (x0, y0, x1, y1, r, color, alpha = 1) => {
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const cx = Math.min(Math.max(x, x0 + r), x1 - r);
      const cy = Math.min(Math.max(y, y0 + r), y1 - r);
      const a = Math.max(0, Math.min(1, r - Math.hypot(x - cx, y - cy) + 0.5));
      if (a > 0) set(x, y, color, a * alpha);
    }
  }
};
const line = (x0, y0, x1, y1, width, color) => {
  const minX = Math.floor(Math.min(x0, x1) - width);
  const maxX = Math.ceil(Math.max(x0, x1) + width);
  const minY = Math.floor(Math.min(y0, y1) - width);
  const maxY = Math.ceil(Math.max(y0, y1) + width);
  const len2 = (x1 - x0) ** 2 + (y1 - y0) ** 2;
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const t = Math.max(0, Math.min(1, ((x - x0) * (x1 - x0) + (y - y0) * (y1 - y0)) / len2));
      const d = Math.hypot(x - (x0 + t * (x1 - x0)), y - (y0 + t * (y1 - y0)));
      const a = Math.max(0, Math.min(1, width / 2 - d + 0.5));
      if (a > 0) set(x, y, color, a);
    }
  }
};
// Soft halo.
disc(400, 270, 250, white, 0.08);

// The sun and its rays.
disc(120, 95, 40, orange);
for (let k = 0; k < 8; k += 1) {
  const a = (k * Math.PI) / 4;
  line(
    120 + 55 * Math.cos(a),
    95 + 55 * Math.sin(a),
    120 + 75 * Math.cos(a),
    95 + 75 * Math.sin(a),
    7,
    orange,
  );
}

// The solar thermal collector: a dark frame and its absorber tubes.
box(60, 190, 290, 300, 10, dark);
for (let x = 80; x < 280; x += 22) line(x, 202, x, 288, 8, glass);
line(70, 198, 280, 198, 6, red);

// Pipes: hot down from the collector to the tank, cold back up.
line(280, 210, 330, 210, 10, red);
line(330, 210, 330, 420, 10, red);
line(330, 420, 400, 420, 10, red);
line(70, 300, 70, 470, 10, blue);
line(70, 470, 470, 470, 10, blue);

// The pump on the cold pipe.
disc(220, 470, 26, white);
disc(220, 470, 14, dark);
line(208, 470, 232, 470, 5, white);

// The hot water tank and its coil.
box(400, 150, 560, 490, 40, white);
box(420, 175, 540, 465, 30, hot, 0.35);
for (let y = 330; y < 450; y += 28) line(425, y, 535, y + 14, 8, red);

// The controller: a box, its display and two buttons.
box(610, 160, 750, 330, 16, white);
box(628, 180, 732, 240, 8, dark);
box(640, 192, 700, 228, 5, glass);
disc(715, 210, 8, hot);
disc(650, 285, 13, dark);
disc(710, 285, 13, dark);

// A thermometer under it.
box(667, 360, 693, 470, 13, white);
disc(680, 470, 22, white);
disc(680, 470, 14, red);
box(675, 400, 685, 465, 5, red);

// Data from the tank to the controller.
line(560, 250, 610, 250, 6, white);
disc(585, 250, 7, white);

// Local network waves above the controller (no cloud).
for (const r of [20, 40, 60]) {
  arc(680, 120, r, 8, -2.4, -0.74, white);
}
disc(680, 120, 6, white);

// PNG encoding.
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8;
ihdr[9] = 2;
const raw = Buffer.alloc((W * 3 + 1) * H);
for (let y = 0; y < H; y += 1) {
  raw[y * (W * 3 + 1)] = 0;
  px.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3);
}
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
writeFileSync(process.argv[2] ?? 'cover.png', png);
console.log('cover', png.length, 'bytes');
