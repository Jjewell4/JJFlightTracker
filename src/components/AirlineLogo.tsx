import { useState } from 'react';
import './AirlineLogo.css';

/**
 * Airline mark: a colored monogram (deterministic hue from the code) that is
 * replaced by the remote logo only once it has actually loaded — so offline or
 * slow networks never show a blank tile.
 */
export function AirlineLogo({ iata, icao, name, size = 36 }: { iata?: string; icao?: string; name?: string; size?: number }) {
  const [state, setState] = useState<'loading' | 'loaded' | 'failed'>('loading');
  const label = (iata || icao || name || '?').slice(0, 2).toUpperCase();
  const hue = hashHue(icao || iata || name || '');
  const style = { width: size, height: size, fontSize: size * 0.36, '--logo-hue': hue } as React.CSSProperties;
  const showImg = !!iata && state !== 'failed';

  return (
    <span className={`airline-logo${state === 'loaded' ? ' airline-logo--loaded' : ''}`} style={style} title={name} role="img" aria-label={name ? `${name} logo` : `${label} logo`}>
      <span className="airline-logo__mono" aria-hidden>
        {label}
      </span>
      {showImg && (
        <img
          src={`https://pics.avs.io/${size * 2}/${size * 2}/${iata}@2x.png`}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          onLoad={(e) => setState(e.currentTarget.naturalWidth > 1 ? 'loaded' : 'failed')}
          onError={() => setState('failed')}
        />
      )}
    </span>
  );
}

function hashHue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}
