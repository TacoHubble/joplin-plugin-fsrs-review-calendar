'use strict';

// Generates catalog-ready PNGs with Node's standard library so contributors
// do not need a graphics package just to reproduce the release assets.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const outputDir = path.resolve(__dirname, '../src/images');
fs.mkdirSync(outputDir, { recursive: true });

const crcTable = Array.from({ length: 256 }, (_, index) => {
	let value = index;
	for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
	return value >>> 0;
});

function crc32(buffer) {
	let crc = 0xffffffff;
	for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
	return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
	const typeBuffer = Buffer.from(type);
	const output = Buffer.alloc(12 + data.length);
	output.writeUInt32BE(data.length, 0);
	typeBuffer.copy(output, 4);
	data.copy(output, 8);
	output.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 8 + data.length);
	return output;
}

function encodePng(width, height, pixels) {
	const rows = Buffer.alloc((width * 4 + 1) * height);
	for (let y = 0; y < height; y += 1) {
		const rowStart = y * (width * 4 + 1);
		rows[rowStart] = 0;
		pixels.copy(rows, rowStart + 1, y * width * 4, (y + 1) * width * 4);
	}
	const header = Buffer.alloc(13);
	header.writeUInt32BE(width, 0);
	header.writeUInt32BE(height, 4);
	header[8] = 8;
	header[9] = 6;
	return Buffer.concat([
		Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
		chunk('IHDR', header),
		chunk('IDAT', zlib.deflateSync(rows, { level: 9 })),
		chunk('IEND', Buffer.alloc(0)),
	]);
}

function canvas(width, height, background = [0, 0, 0, 0]) {
	const pixels = Buffer.alloc(width * height * 4);
	for (let index = 0; index < width * height; index += 1) {
		pixels[index * 4] = background[0];
		pixels[index * 4 + 1] = background[1];
		pixels[index * 4 + 2] = background[2];
		pixels[index * 4 + 3] = background[3];
	}
	return { width, height, pixels };
}

function put(image, x, y, color) {
	if (x < 0 || y < 0 || x >= image.width || y >= image.height) return;
	const index = (Math.floor(y) * image.width + Math.floor(x)) * 4;
	for (let channel = 0; channel < 4; channel += 1) image.pixels[index + channel] = color[channel];
}

function rect(image, x, y, width, height, color, radius = 0) {
	for (let py = Math.floor(y); py < Math.ceil(y + height); py += 1) {
		for (let px = Math.floor(x); px < Math.ceil(x + width); px += 1) {
			if (radius) {
				const cx = Math.max(x + radius, Math.min(px, x + width - radius));
				const cy = Math.max(y + radius, Math.min(py, y + height - radius));
				if ((px - cx) ** 2 + (py - cy) ** 2 > radius ** 2) continue;
			}
			put(image, px, py, color);
		}
	}
}

function line(image, x1, y1, x2, y2, thickness, color) {
	const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1), 1);
	for (let step = 0; step <= steps; step += 1) {
		const x = x1 + (x2 - x1) * (step / steps);
		const y = y1 + (y2 - y1) * (step / steps);
		rect(image, x - thickness / 2, y - thickness / 2, thickness, thickness, color, thickness / 2);
	}
}

function drawMark(image, x, y, width, height) {
	const purple = [93, 63, 211, 255];
	const purpleDark = [58, 41, 149, 255];
	const white = [255, 255, 255, 255];
	const mint = [74, 222, 128, 255];
	const unit = Math.min(width, height) / 128;
	rect(image, x, y, width, height, purpleDark, 22 * unit);
	rect(image, x + 6 * unit, y + 6 * unit, width - 12 * unit, height - 12 * unit, purple, 18 * unit);
	rect(image, x + 22 * unit, y + 25 * unit, width - 44 * unit, height - 46 * unit, white, 10 * unit);
	rect(image, x + 22 * unit, y + 25 * unit, width - 44 * unit, 25 * unit, [129, 105, 235, 255], 9 * unit);
	line(image, x + 40 * unit, y + 18 * unit, x + 40 * unit, y + 34 * unit, 7 * unit, white);
	line(image, x + 88 * unit, y + 18 * unit, x + 88 * unit, y + 34 * unit, 7 * unit, white);
	for (const gx of [43, 64, 85]) for (const gy of [61, 80]) rect(image, x + (gx - 4) * unit, y + (gy - 4) * unit, 8 * unit, 8 * unit, [216, 211, 247, 255], 2 * unit);
	line(image, x + 47 * unit, y + 86 * unit, x + 59 * unit, y + 98 * unit, 8 * unit, mint);
	line(image, x + 58 * unit, y + 98 * unit, x + 84 * unit, y + 69 * unit, 8 * unit, mint);
}

for (const size of [16, 32, 48, 128]) {
	const image = canvas(size, size);
	drawMark(image, 0, 0, size, size);
	fs.writeFileSync(path.join(outputDir, `icon-${size}.png`), encodePng(size, size, image.pixels));
}

const promo = canvas(440, 280, [31, 35, 48, 255]);
drawMark(promo, 36, 76, 128, 128);
// Decorative review intervals communicate a timeline without embedding text,
// keeping the tile useful in every locale.
for (let index = 0; index < 4; index += 1) {
	const left = 205 + index * 48;
	const top = 92 + index * 18;
	rect(promo, left, top, 31, 31, [93, 63, 211, 255], 8);
	line(promo, left + 8, top + 17, left + 14, top + 23, 4, [74, 222, 128, 255]);
	line(promo, left + 14, top + 23, left + 25, top + 9, 4, [74, 222, 128, 255]);
	if (index < 3) line(promo, left + 32, top + 16, left + 46, top + 16, 3, [129, 105, 235, 255]);
}
rect(promo, 205, 187, 179, 8, [129, 105, 235, 255], 4);
rect(promo, 205, 207, 129, 8, [74, 222, 128, 255], 4);
fs.writeFileSync(path.join(outputDir, 'promo-tile.png'), encodePng(promo.width, promo.height, promo.pixels));

console.log(`Generated catalog assets in ${outputDir}`);
