import { rgbToHex } from './color.js';

const api = globalThis.browser ?? globalThis.chrome;

const stage = document.getElementById('stage');
const ctx = stage.getContext('2d', { willReadFrequently: true });
const loupe = document.getElementById('loupe');
const loupeCanvas = document.getElementById('loupe-canvas');
const loupeCtx = loupeCanvas.getContext('2d');
const loupeHex = document.getElementById('loupe-hex');

const LOUPE_PIXELS = 11; // odd, so the center cell is the sampled pixel
const LOUPE_SIZE = 110;
const CELL = LOUPE_SIZE / LOUPE_PIXELS;

let sourceCtx;
let naturalWidth;
let naturalHeight;
let scale;
let offsetX;
let offsetY;
let lastPixel = null;

async function init() {
  const stored = await api.storage.session.get('pickerImage');
  const dataUrl = stored.pickerImage;
  if (!dataUrl) {
    window.close();
    return;
  }

  const img = new Image();
  img.src = dataUrl;
  await img.decode();

  // Captured at the display's actual pixel resolution (not CSS pixels), so
  // sampling from this offscreen canvas is accurate on HiDPI screens — the
  // on-screen <canvas> below is only a scaled-down view for the user's eyes.
  naturalWidth = img.naturalWidth;
  naturalHeight = img.naturalHeight;
  const sourceCanvas = document.createElement('canvas');
  sourceCanvas.width = naturalWidth;
  sourceCanvas.height = naturalHeight;
  sourceCtx = sourceCanvas.getContext('2d', { willReadFrequently: true });
  sourceCtx.drawImage(img, 0, 0);

  layout();
  draw(sourceCanvas);

  window.addEventListener('resize', () => {
    layout();
    draw(sourceCanvas);
  });
  stage.addEventListener('mousemove', onMove);
  stage.addEventListener('click', onClick);
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') window.close();
  });
}

function layout() {
  stage.width = window.innerWidth;
  stage.height = window.innerHeight;
  scale = Math.min(stage.width / naturalWidth, stage.height / naturalHeight);
  offsetX = (stage.width - naturalWidth * scale) / 2;
  offsetY = (stage.height - naturalHeight * scale) / 2;
}

function draw(sourceCanvas) {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, stage.width, stage.height);
  ctx.drawImage(sourceCanvas, offsetX, offsetY, naturalWidth * scale, naturalHeight * scale);
}

function sourcePixelAt(clientX, clientY) {
  const sx = Math.floor((clientX - offsetX) / scale);
  const sy = Math.floor((clientY - offsetY) / scale);
  if (sx < 0 || sy < 0 || sx >= naturalWidth || sy >= naturalHeight) return null;
  const [r, g, b] = sourceCtx.getImageData(sx, sy, 1, 1).data;
  return { r, g, b, sx, sy };
}

function positionLoupe(clientX, clientY) {
  const margin = 24;
  let left = clientX + margin;
  let top = clientY + margin;
  if (left + LOUPE_SIZE > window.innerWidth) left = clientX - margin - LOUPE_SIZE;
  if (top + 138 > window.innerHeight) top = clientY - margin - 138;
  loupe.style.left = `${left}px`;
  loupe.style.top = `${top}px`;
}

function renderLoupe(sx, sy) {
  loupeCtx.clearRect(0, 0, LOUPE_SIZE, LOUPE_SIZE);
  const half = Math.floor(LOUPE_PIXELS / 2);
  for (let row = 0; row < LOUPE_PIXELS; row++) {
    const py = sy - half + row;
    if (py < 0 || py >= naturalHeight) continue;
    for (let col = 0; col < LOUPE_PIXELS; col++) {
      const px = sx - half + col;
      if (px < 0 || px >= naturalWidth) continue;
      const [r, g, b] = sourceCtx.getImageData(px, py, 1, 1).data;
      loupeCtx.fillStyle = `rgb(${r}, ${g}, ${b})`;
      loupeCtx.fillRect(col * CELL, row * CELL, CELL, CELL);
    }
  }
}

function onMove(event) {
  const pixel = sourcePixelAt(event.clientX, event.clientY);
  if (!pixel) {
    loupe.hidden = true;
    lastPixel = null;
    return;
  }
  lastPixel = pixel;
  loupe.hidden = false;
  positionLoupe(event.clientX, event.clientY);
  renderLoupe(pixel.sx, pixel.sy);
  loupeHex.textContent = rgbToHex(pixel).toUpperCase();
}

async function onClick() {
  if (!lastPixel) return;
  const hex = rgbToHex(lastPixel);
  await api.runtime.sendMessage({ type: 'addToHistory', hex });
  window.close();
}

init();
