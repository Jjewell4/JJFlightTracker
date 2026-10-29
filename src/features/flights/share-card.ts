/**
 * Renders a flight as a 1080×1350 share image (route map, codes, key facts) and hands it to
 * the system share sheet, falling back to a download. Canvas can't read CSS variables, so the
 * palette below mirrors the dark theme tokens in src/styles/tokens.css.
 */
import { getAirport } from '@/data/reference';
import { airportCode, flightAirlineName, flightDistanceKm } from '@/lib/flight-utils';
import { greatCirclePoints } from '@/lib/geo';
import { formatDuration, formatFlightDate } from '@/lib/time';
import type { Flight } from '@/lib/types';
import { formatDistance } from './flight-logic';
import { prettyFlightNumber } from './FlightRow';
import { fitView, landDots } from './projection';

const W = 1080;
const H = 1350;
const C = {
  bg: '#0a0e16',
  bg2: '#141c2e',
  land: 'rgba(148, 170, 214, 0.22)',
  text: '#eef2fa',
  text2: '#a9b4c9',
  text3: '#6f7b93',
  accent: '#5cc8ff',
  accent2: '#ffb547',
  border: 'rgba(148, 170, 214, 0.16)',
};
const SANS = '"Inter Variable", Inter, system-ui, sans-serif';
const MONO = '"JetBrains Mono Variable", ui-monospace, monospace';

export interface ShareCardOptions {
  unit: 'mi' | 'km';
  /** e.g. "My 12th flight on this route" */
  caption?: string;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, font: (size: number) => string, start: number, min: number) {
  let size = start;
  ctx.font = font(size);
  while (size > min && ctx.measureText(text).width > maxWidth) {
    size -= 2;
    ctx.font = font(size);
  }
  return size;
}

function ellipsize(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxWidth) t = t.slice(0, -1);
  return `${t}…`;
}

export async function renderShareCard(f: Flight, opts: ShareCardOptions): Promise<Blob> {
  try {
    await Promise.all([document.fonts.load(`700 80px ${SANS}`), document.fonts.load(`700 80px ${MONO}`)]);
  } catch {
    /* fall back to system fonts */
  }
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');

  // Background
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, C.bg2);
  bg.addColorStop(1, C.bg);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W * 0.5, 380, 40, W * 0.5, 380, 620);
  glow.addColorStop(0, 'rgba(92, 200, 255, 0.16)');
  glow.addColorStop(1, 'rgba(92, 200, 255, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  const from = getAirport(f.from);
  const to = getAirport(f.to);
  const fromCode = airportCode(f.from);
  const toCode = airportCode(f.to);

  // Map
  const mapY = 120;
  const mapH = 600;
  if (from && to) {
    const arc = greatCirclePoints(from, to, 96);
    const view = fitView(arc, W, mapH, { padding: 0.28, minSpanDeg: 30 });
    ctx.save();
    ctx.translate(0, mapY);
    ctx.fillStyle = C.land;
    for (const [x, y] of landDots(view, 14)) {
      ctx.beginPath();
      ctx.arc(x, y, 2.6, 0, Math.PI * 2);
      ctx.fill();
    }
    const pts = arc.map(([lon, lat]) => view.project(lon, lat));
    const [sx, sy] = pts[0];
    const [ex, ey] = pts[pts.length - 1];
    const grad = ctx.createLinearGradient(sx, sy, ex, ey);
    grad.addColorStop(0, C.accent);
    grad.addColorStop(1, C.accent2);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const [width, alpha] of [[18, 0.12], [6, 1]] as const) {
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = grad;
      ctx.lineWidth = width;
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    for (const [x, y, color, label] of [[sx, sy, C.accent, fromCode], [ex, ey, C.accent2, toCode]] as const) {
      ctx.fillStyle = C.bg;
      ctx.beginPath();
      ctx.arc(x, y, 16, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 7;
      ctx.strokeStyle = color;
      ctx.stroke();
      ctx.font = `700 34px ${MONO}`;
      ctx.fillStyle = C.text;
      const tw = ctx.measureText(label).width;
      const lx = Math.min(Math.max(x - tw / 2, 24), W - tw - 24);
      ctx.fillText(label, lx, y < 70 ? y + 64 : y - 34);
    }
    ctx.restore();
  }

  // Brand
  ctx.fillStyle = C.text2;
  ctx.font = `600 34px ${SANS}`;
  ctx.fillText('✈  FlightJournal', 72, 92);

  // Codes
  const codes = `${fromCode} → ${toCode}`;
  fitText(ctx, codes, W - 144, (s) => `800 ${s}px ${MONO}`, 150, 80);
  ctx.fillStyle = C.text;
  ctx.fillText(codes, 72, 860);

  // Cities
  const cities = `${from?.city || from?.name || fromCode} to ${to?.city || to?.name || toCode}`;
  ctx.font = `500 44px ${SANS}`;
  ctx.fillStyle = C.text2;
  ctx.fillText(ellipsize(ctx, cities, W - 144), 72, 930);

  // Facts grid
  const km = flightDistanceKm(f);
  const airline = flightAirlineName(f);
  const facts: [string, string][] = [
    ['Date', formatFlightDate(f.date, f.datePrecision, 'short')],
    ['Flight', [prettyFlightNumber(f.flightNumber), airline].filter(Boolean).join(' · ') || '—'],
    ['Distance', km ? formatDistance(km, opts.unit) : '—'],
    ['Duration', f.durationMin ? formatDuration(f.durationMin) : '—'],
  ];
  const gx = 72;
  const gy = 1000;
  const cw = (W - 144 - 24) / 2;
  const ch = 120;
  facts.forEach(([label, value], i) => {
    const x = gx + (i % 2) * (cw + 24);
    const y = gy + Math.floor(i / 2) * (ch + 20);
    roundRect(ctx, x, y, cw, ch, 24);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.fill();
    ctx.strokeStyle = C.border;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.font = `600 26px ${SANS}`;
    ctx.fillStyle = C.text3;
    ctx.fillText(label.toUpperCase(), x + 28, y + 44);
    ctx.font = `700 38px ${SANS}`;
    ctx.fillStyle = C.text;
    ctx.fillText(ellipsize(ctx, value, cw - 56), x + 28, y + 94);
  });

  if (opts.caption) {
    ctx.font = `600 30px ${SANS}`;
    ctx.fillStyle = C.accent2;
    ctx.fillText(ellipsize(ctx, opts.caption, W - 144), 72, 1300);
  }

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not create image'))), 'image/png'));
}

/** Shares the card via the system share sheet when supported; otherwise downloads it. Returns how. */
export async function shareFlightImage(f: Flight, opts: ShareCardOptions): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const blob = await renderShareCard(f, opts);
  const name = `flight-${[airportCode(f.from), airportCode(f.to), f.date].join('-').toLowerCase()}.png`;
  const file = new File([blob], name, { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: `${airportCode(f.from)} → ${airportCode(f.to)}` });
      return 'shared';
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'cancelled';
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return 'downloaded';
}
