import { useState } from 'react';
import './AirlineLogo.css';

/**
 * Airline mark: tries a remote logo by IATA code, falls back to a colored
 * monogram (deterministic hue from the code) when offline or unavailable.
 */
export function AirlineLogo({ iata, icao, name, size = 36 }: { iata?: string; icao?: string; name?: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  const code = iata || icao || '';
  const label = (iata || icao || name || '?').slice(0, 2).toUpperCase();
  const hue = hashHue(icao || iata || name || '');
  const style = { width: size, height: size, '--logo-hue': hue } as React.CSSProperties;

  if (iata && !failed) {
    return (
      <span className="airline-logo airline-logo--img" style={style} title={name}>
        <img
          src={`https://pics.avs.io/${size * 2}/${size * 2}/${iata}@2x.png`}
          alt={name ? `${name} logo` : `${code} logo`}
          width={size}
          height={size}
          loading="lazy"
          onError={() => setFailed(true)}
        />
      </span>
    );
  }
  return (
    <span className="airline-logo airline-logo--mono" style={style} title={name} aria-label={name}>
      {label}
    </span>
  );
}

function hashHue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}
