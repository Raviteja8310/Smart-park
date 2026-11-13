/**
 * Tints the SMARTPARK wordmark on the sign-in screen to match the lighting in the
 * background video. It samples the pixels directly behind the wordmark a few times a
 * second, takes the hue of that light, and writes CSS variables onto the panel:
 *
 *   --brand-a / --brand-b / --brand-c   gradient stops for the SMARTPARK letters
 *   --brand-tag                         tagline colour
 *   --brand-glow                        soft glow colour
 *
 * Hue follows the scene (purple neon at night, warm amber when the garage lights come on);
 * lightness is chosen for contrast, so the text stays readable whatever the frame looks like.
 * Styles that use the variables live in scenes.css under `.auth-story[data-adaptive-brand]`.
 */

const SAMPLE_MS = 160;          // ~6 samples a second
const EASE = 0.18;              // how quickly the colour follows a change (0..1 per sample)
const FALLBACK_HUE = 235;       // brand indigo, used when the light has no clear colour
const OVERLAY_DARKEN = 0.5;     // the panel overlay roughly halves brightness behind the wordmark

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b); const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

/** Interpolate hue along the shorter way round the colour wheel. */
function mixHue(from, to, t) {
  const delta = ((to - from + 540) % 360) - 180;
  return (from + delta * t + 360) % 360;
}

/** Map the element's on-screen box onto source pixels of a cover-fitted video/image. */
function sourceRect(media, mediaW, mediaH, target, focusY) {
  const box = media.getBoundingClientRect();
  const r = target.getBoundingClientRect();
  if (!box.width || !box.height || !mediaW || !mediaH) return null;
  const scale = Math.max(box.width / mediaW, box.height / mediaH);
  const offX = (box.width - mediaW * scale) / 2;
  const offY = (box.height - mediaH * scale) * focusY;
  const sx = (r.left - box.left - offX) / scale;
  const sy = (r.top - box.top - offY) / scale;
  const sw = r.width / scale;
  const sh = r.height / scale;
  const x = Math.max(0, Math.min(mediaW - 1, sx));
  const y = Math.max(0, Math.min(mediaH - 1, sy));
  return { x, y, w: Math.max(1, Math.min(mediaW - x, sw)), h: Math.max(1, Math.min(mediaH - y, sh)) };
}

function union(a, b) {
  const ra = a.getBoundingClientRect(); const rb = b ? b.getBoundingClientRect() : ra;
  const left = Math.min(ra.left, rb.left); const top = Math.min(ra.top, rb.top);
  const right = Math.max(ra.right, rb.right); const bottom = Math.max(ra.bottom, rb.bottom);
  return { getBoundingClientRect: () => ({ left, top, width: right - left, height: bottom - top }) };
}

/**
 * Start tinting. `media` is the <video> (or a loaded <img> for the still poster).
 * Returns a stop() function.
 */
export function startAdaptiveBrandTint(media, { focusY = 0.58, still = false } = {}) {
  const panel = media.closest('.auth-story');
  const name = panel?.querySelector('.sp-brand-hero-name');
  if (!panel || !name) return () => {};
  const tagline = panel.querySelector('.sp-brand-hero-tagline');
  const canvas = document.createElement('canvas');
  canvas.width = 32; canvas.height = 10;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return () => {};

  let hue = FALLBACK_HUE; let sat = 0.6; let light = 0.2; let first = true;
  let timer = 0; let stopped = false;

  const apply = () => {
    const s = Math.round(Math.min(0.95, Math.max(0.62, sat)) * 100);
    const h2 = (hue + 28) % 360; // a neighbouring hue gives the gradient some depth
    // Behind the overlay the scene is almost always dark, so light letters; flip to dark ink only on a genuinely bright frame.
    const bright = light * (1 - OVERLAY_DARKEN) > 0.55;
    const L = bright ? [16, 26, 32, 22, 40] : [90, 78, 72, 80, 62];
    panel.style.setProperty('--brand-a', `hsl(${hue.toFixed(1)} ${Math.min(s, 80)}% ${L[0]}%)`);
    panel.style.setProperty('--brand-b', `hsl(${hue.toFixed(1)} ${s}% ${L[1]}%)`);
    panel.style.setProperty('--brand-c', `hsl(${h2.toFixed(1)} ${s}% ${L[2]}%)`);
    panel.style.setProperty('--brand-tag', `hsl(${hue.toFixed(1)} ${s}% ${L[3]}%)`);
    panel.style.setProperty('--brand-glow', `hsl(${hue.toFixed(1)} ${s}% ${L[4]}% / ${bright ? 0.35 : 0.55})`);
    panel.setAttribute('data-adaptive-brand', bright ? 'dark-ink' : 'light-ink');
  };

  const sample = () => {
    if (stopped) return;
    const mediaW = media.videoWidth || media.naturalWidth;
    const mediaH = media.videoHeight || media.naturalHeight;
    const ready = media.tagName === 'VIDEO' ? media.readyState >= 2 : media.complete;
    const rect = ready ? sourceRect(media, mediaW, mediaH, union(name, tagline), focusY) : null;
    if (rect) {
      try {
        ctx.drawImage(media, rect.x, rect.y, rect.w, rect.h, 0, 0, canvas.width, canvas.height);
        const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
        // Weight each pixel by its brightness so the light sources (neon, lamps) decide the colour, not dark walls.
        let r = 0; let g = 0; let b = 0; let wsum = 0; let lum = 0;
        for (let i = 0; i < data.length; i += 4) {
          const y = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
          const w = 0.05 + y * y;
          r += data[i] * w; g += data[i + 1] * w; b += data[i + 2] * w; wsum += w; lum += y;
        }
        const [h, s] = rgbToHsl(r / wsum, g / wsum, b / wsum);
        const targetHue = s < 0.08 ? FALLBACK_HUE : h;
        const avgLight = lum / (data.length / 4);
        const t = first ? 1 : EASE;
        hue = mixHue(hue, targetHue, t);
        sat += (Math.max(s, 0.35) - sat) * t;
        light += (avgLight - light) * t;
        first = false;
        apply();
      } catch {
        stop(); // e.g. a cross-origin source that cannot be read; the default styling stays
        return;
      }
    }
    if (!still) timer = window.setTimeout(sample, SAMPLE_MS);
  };

  function stop() {
    stopped = true;
    window.clearTimeout(timer);
    panel.removeAttribute('data-adaptive-brand');
    ['--brand-a', '--brand-b', '--brand-c', '--brand-tag', '--brand-glow'].forEach((v) => panel.style.removeProperty(v));
  }

  sample();
  return stop;
}
