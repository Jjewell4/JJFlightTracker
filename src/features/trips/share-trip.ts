import { tripDates, tripTitle, type Trip } from '@/lib/trips';
import { formatDistance } from '@/features/flights/flight-logic';
import { routeText } from './trip-format';
import type { Settings } from '@/lib/types';
/** Creates a recap locally. Private notes are deliberately excluded. */
export async function shareTripImage(trip: Trip, unit: Settings['distanceUnit'], cover?: string): Promise<'shared' | 'downloaded'> {
  await document.fonts.ready;
  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  canvas.height = 1350;
  const c = canvas.getContext('2d');
  if (!c) throw new Error('Image creation is unavailable');
  const style = getComputedStyle(document.documentElement);
  const token = (name: string) => style.getPropertyValue(name).trim();
  c.fillStyle = token('--surface');
  c.fillRect(0, 0, 1080, 1350);
  if (cover) {
    const image = new Image();
    image.src = cover;
    await image.decode();
    const scale = Math.max(1080 / image.width, 650 / image.height);
    c.drawImage(image, (1080 - image.width * scale) / 2, (650 - image.height * scale) / 2, image.width * scale, image.height * scale);
  } else {
    const gradient = c.createLinearGradient(0, 0, 1080, 650);
    gradient.addColorStop(0, token('--surface-3'));
    gradient.addColorStop(1, token('--bg'));
    c.fillStyle = gradient;
    c.fillRect(0, 0, 1080, 650);
    c.strokeStyle = token('--accent');
    c.lineWidth = 5;
    c.beginPath();
    c.moveTo(100, 480);
    c.bezierCurveTo(280, 120, 720, 120, 980, 410);
    c.stroke();
    for (const [x, y] of [
      [100, 480],
      [980, 410],
    ]) {
      c.fillStyle = token('--accent-2');
      c.beginPath();
      c.arc(x, y, 12, 0, Math.PI * 2);
      c.fill();
    }
  }
  c.fillStyle = token('--text');
  c.font = '700 60px "Inter Variable", sans-serif';
  const wrap = (text: string, y: number, font: string, max = 920) => {
    c.font = font;
    let line = '';
    for (const word of text.split(' ')) {
      if (c.measureText(`${line} ${word}`).width > max && line) {
        c.fillText(line, 80, y);
        y += 74;
        line = word;
      } else line += (line ? ' ' : '') + word;
    }
    c.fillText(line, 80, y);
    return y + 74;
  };
  let y = wrap(tripTitle(trip), 750, '700 60px "Inter Variable", sans-serif');
  c.fillStyle = token('--text-2');
  y = wrap(tripDates(trip), y + 10, '400 32px "Inter Variable", sans-serif');
  c.fillStyle = token('--accent');
  y = wrap(`${trip.flights.length} flights · ${formatDistance(trip.distanceKm, unit)}`, y + 15, '700 40px "Inter Variable", sans-serif');
  c.fillStyle = token('--text-2');
  wrap(routeText(trip), y + 10, '400 30px "Inter Variable", sans-serif');
  c.font = '600 28px "Inter Variable", sans-serif';
  c.fillText('Window Seat · My flight journal', 80, 1280);
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not create recap'))), 'image/png'),
  );
  const file = new File([blob], 'trip-recap.png', { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] }) && navigator.share) {
    await navigator.share({ files: [file], title: tripTitle(trip) });
    return 'shared';
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return 'downloaded';
}
