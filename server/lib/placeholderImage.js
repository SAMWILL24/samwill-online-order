const sharp = require('sharp');

// React Native's <Image> can't render SVG data URIs, so placeholders are rasterized to PNG here
// (this only runs once at seed time) rather than shipped as inline SVG.
async function categoryPlaceholder(emoji, bgColor) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300">
    <rect width="400" height="300" fill="${bgColor}"/>
    <text x="200" y="175" font-size="120" text-anchor="middle" dominant-baseline="middle">${emoji}</text>
  </svg>`;
  const buffer = await sharp(Buffer.from(svg)).png().toBuffer();
  return `data:image/png;base64,${buffer.toString('base64')}`;
}

module.exports = { categoryPlaceholder };
