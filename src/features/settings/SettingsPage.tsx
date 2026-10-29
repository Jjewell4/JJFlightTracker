import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Icon, type IconName } from '@/components/Icon';
import { Switch } from '@/components/Switch';
import { clearDrafts } from '@/services/screenshot/drafts';
import { useInstallPrompt } from '@/components/PwaPrompts';
import { allCountries, useReferenceReady } from '@/data/reference';
import { seedSampleFlights } from '@/dev/sample-data';
import { deleteAllFlights, getAllFlights, getSettings, saveSettings, useFlights, useSettings } from '@/lib/db';
import type { Settings } from '@/lib/types';
import {
  backupFileName,
  backupToJson,
  buildBackup,
  csvFileName,
  downloadText,
  exportFr24Csv,
  formatBytes,
  getStorageEstimate,
  isStoragePersisted,
  requestPersistentStorage,
} from '@/services/import';
import { ConfirmSheet } from '@/components/Sheet';
import { CloudSyncSection } from './CloudSyncSection';
import { useCloudSync } from '@/services/sync/controller';
import './settings.css';
import { PublicSharing } from '@/features/public/PublicSharing';
import { exportSpreadsheetCsv } from '@/services/import/export-csv';

function Group({ title, footer, children }: { title?: string; footer?: ReactNode; children: ReactNode }) {
  return (
    <section className="sgroup">
      {title && <h2 className="section-title sgroup__title">{title}</h2>}
      <div className="list">{children}</div>
      {footer && <p className="sgroup__footer">{footer}</p>}
    </section>
  );
}

function Tile({ icon, tone = 'accent' }: { icon: IconName; tone?: 'accent' | 'amber' | 'danger' | 'green' | 'plain' }) {
  return (
    <span className={`stile stile--${tone}`} aria-hidden>
      <Icon name={icon} size={18} />
    </span>
  );
}

function RowText({ title, sub }: { title: string; sub?: ReactNode }) {
  return (
    <span className="srow__text">
      <span className="srow__title">{title}</span>
      {sub && <span className="srow__sub">{sub}</span>}
    </span>
  );
}

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" className="seg__opt" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

const set = (patch: Partial<Settings>) => void saveSettings(patch);

export default function SettingsPage() {
  const settings = useSettings();
  const flights = useFlights();
  const refReady = useReferenceReady();
  const install = useInstallPrompt();
  const cloud = useCloudSync();
  const syncing = cloud.phase === 'signed-in';
  const count = flights?.length ?? 0;

  const [flash, setFlash] = useState<string | undefined>();
  const [confirm, setConfirm] = useState<'delete' | 'sample' | null>(null);
  const [busy, setBusy] = useState(false);
  const [keyDraft, setKeyDraft] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [storage, setStorage] = useState<{ usage: number; quota: number } | undefined>();
  const [persisted, setPersisted] = useState<boolean | undefined>();

  const say = useCallback((msg: string) => {
    setFlash(msg);
    setTimeout(() => setFlash((m) => (m === msg ? undefined : m)), 4500);
  }, []);

  const refreshStorage = useCallback(() => {
    void getStorageEstimate().then(setStorage);
    void isStoragePersisted().then(setPersisted);
  }, []);
  useEffect(refreshStorage, [refreshStorage, count]);

  const countries = useMemo(() => [...allCountries()].sort((a, b) => a.name.localeCompare(b.name)), [refReady]);

  async function exportBackup() {
    const [all, s] = await Promise.all([getAllFlights(), getSettings()]);
    const now = new Date();
    downloadText(backupFileName(now), backupToJson(buildBackup(all, s, now)), 'application/json');
    say(`Backup saved — ${all.length} ${all.length === 1 ? 'flight' : 'flights'}.`);
  }

  async function exportCsv(compatible = false) {
    const all = await getAllFlights();
    downloadText(csvFileName(), compatible ? exportFr24Csv(all) : exportSpreadsheetCsv(all), 'text/csv', true);
    say(`CSV saved — ${all.length} ${all.length === 1 ? 'flight' : 'flights'}.`);
  }

  async function doInstall() {
    const r = await install.install();
    if (r === 'accepted') say('Installing FlightJournal…');
  }

  async function protect() {
    const ok = await requestPersistentStorage();
    say(ok ? 'Your log is now protected from automatic cleanup.' : 'Your browser didn’t grant this yet. Installing the app usually helps.');
    refreshStorage();
  }

  async function runConfirmed() {
    setBusy(true);
    try {
      if (confirm === 'delete') {
        await deleteAllFlights();
        await clearDrafts();
        say('All flights deleted.');
      } else if (confirm === 'sample') {
        const n = await seedSampleFlights();
        say(`Loaded ${n} sample flights.`);
      }
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  }

  const savedKey = settings.aeroDataBoxKey ?? '';
  const keyValue = keyDraft ?? savedKey;
  const keyDirty = keyDraft !== null && keyDraft.trim() !== savedKey;
  const usagePct = storage ? Math.max(1, Math.round((storage.usage / storage.quota) * 100)) : 0;

  return (
    <div className="settings animate-in">
      <header className="page-header">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-subtitle">Import, export and make the app yours.</p>
        </div>
      </header>

      {flash && (
        <div className="settings__flash" role="status" aria-live="polite">
          <Icon name="check" size={16} strokeWidth={2.25} /> {flash}
        </div>
      )}

      <CloudSyncSection Group={Group} />
      <PublicSharing />

      {/* ---------------------------------------------------------------- */}
      <Group title="Import & export">
        <Link to="/import" className="list__row srow">
          <Tile icon="upload" />
          <RowText title="Import flights" sub="CSV, Excel, another tracker or JSON backup" />
          <Icon name="chevron" size={18} className="srow__chev" />
        </Link>
        <button type="button" className="list__row srow" onClick={() => void exportBackup()}>
          <Tile icon="download" tone="green" />
          <RowText title="Export backup" sub={`JSON with all flights and settings${count ? ` · ${count.toLocaleString()} ${count === 1 ? 'flight' : 'flights'}` : ''}`} />
        </button>
        <button type="button" className="list__row srow" onClick={() => void exportCsv()}>
          <Tile icon="file" tone="amber" />
          <RowText title="Export CSV" sub="Readable columns for Excel, Sheets and other apps" />
        </button>
        <button type="button" className="list__row srow" onClick={() => void exportCsv(true)}>
          <Tile icon="file" tone="plain" /><RowText title="Export for Flightradar24" sub="Compatibility format for existing tracker workflows" />
        </button>
      </Group>

      {/* ---------------------------------------------------------------- */}
      <Group title="Preferences">
        <div className="list__row srow srow--stack">
          <RowText title="Home country" sub="Decides what counts as domestic or international" />
          <select className="input" value={settings.homeCountry} onChange={(e) => set({ homeCountry: e.target.value })} aria-label="Home country" disabled={!refReady}>
            {!countries.some((c) => c.code === settings.homeCountry) && <option value={settings.homeCountry}>{settings.homeCountry}</option>}
            {countries.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="list__row srow srow--stack">
          <RowText title="Distance" />
          <Segmented
            label="Distance unit"
            value={settings.distanceUnit}
            onChange={(v) => set({ distanceUnit: v })}
            options={[
              { value: 'mi', label: 'Miles' },
              { value: 'km', label: 'Kilometres' },
            ]}
          />
        </div>
        <div className="list__row srow srow--stack">
          <RowText title="Clock" />
          <Segmented
            label="Clock format"
            value={settings.clock}
            onChange={(v) => set({ clock: v })}
            options={[
              { value: '12h', label: '12-hour' },
              { value: '24h', label: '24-hour' },
            ]}
          />
        </div>
        <div className="list__row srow srow--stack">
          <RowText title="Appearance" />
          <Segmented
            label="Theme"
            value={settings.theme}
            onChange={(v) => set({ theme: v })}
            options={[
              { value: 'system', label: 'System' },
              { value: 'dark', label: 'Dark' },
              { value: 'light', label: 'Light' },
            ]}
          />
        </div>
        <div className="list__row srow">
          <RowText title="Show airline logos" sub="Loaded from pics.avs.io, which sees which airlines you view. Off shows letter badges instead." />
          <Switch checked={settings.showAirlineLogos !== false} onChange={(v) => set({ showAirlineLogos: v })} label="Show airline logos" />
        </div>
      </Group>

      {/* ---------------------------------------------------------------- */}
      <Group
        title="Flight data lookup"
        footer="Lookups fill in airline, route and aircraft when you log a flight. adsbdb.com receives only the flight’s callsign (e.g. UAL123); AeroDataBox, if you add a key, receives only the flight number and date. Nothing else from your log is sent, and lookups quietly do nothing when you’re offline."
      >
        <div className="list__row srow">
          <Tile icon="search" tone="accent" />
          <RowText title="adsbdb route lookup" sub="Free, no account. Sends the flight number you type to adsbdb.com to find its route." />
          <Switch checked={settings.enableAdsbdb} onChange={(v) => set({ enableAdsbdb: v })} label="Enable adsbdb route lookup" />
        </div>
        <div className="list__row srow srow--stack">
          <RowText
            title="AeroDataBox API key"
            sub={
              <>
                Optional. Adds scheduled times and aircraft for a flight on a given date. Get a free key on{' '}
                <a href="https://rapidapi.com/aedbx-aedbx/api/aerodatabox" target="_blank" rel="noopener noreferrer">
                  RapidAPI
                </a>
                . Stored only on this device.
              </>
            }
          />
          <div className="skey">
            <input
              className="input mono"
              type={showKey ? 'text' : 'password'}
              value={keyValue}
              onChange={(e) => setKeyDraft(e.target.value)}
              placeholder="Paste your X-RapidAPI-Key"
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              aria-label="AeroDataBox API key"
            />
            <button type="button" className="btn btn--ghost" onClick={() => setShowKey((s) => !s)} aria-pressed={showKey}>
              {showKey ? 'Hide' : 'Show'}
            </button>
          </div>
          {(keyDirty || savedKey) && (
            <div className="row">
              {savedKey && keyDraft === null && <span className="badge badge--accent">Key saved</span>}
              <span className="spacer" />
              {savedKey && (
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => {
                    set({ aeroDataBoxKey: '' });
                    setKeyDraft(null);
                  }}
                >
                  Remove
                </button>
              )}
              {keyDirty && (
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() => {
                    set({ aeroDataBoxKey: keyDraft!.trim() });
                    setKeyDraft(null);
                    say('API key saved on this device.');
                  }}
                >
                  Save key
                </button>
              )}
            </div>
          )}
        </div>
      </Group>

      {/* ---------------------------------------------------------------- */}
      <Group title="App">
        {install.isStandalone ? (
          <div className="list__row srow">
            <Tile icon="check" tone="green" />
            <RowText title="Installed" sub="You’re using FlightJournal as an app." />
          </div>
        ) : install.canInstall ? (
          <button type="button" className="list__row srow" onClick={() => void doInstall()}>
            <Tile icon="plus" />
            <RowText title="Install app" sub="Add FlightJournal to your home screen — works offline." />
            <span className="badge badge--accent">Install</span>
          </button>
        ) : install.isIosSafari ? (
          <div className="list__row srow srow--stack">
            <div className="row">
              <Tile icon="share" />
              <RowText title="Install on iPhone or iPad" />
            </div>
            <ol className="sinstall">
              <li>
                Tap <Icon name="share" size={16} className="sinstall__glyph" /> <strong>Share</strong> in Safari’s toolbar.
              </li>
              <li>
                Choose <strong>Add to Home Screen</strong>, then <strong>Add</strong>.
              </li>
            </ol>
          </div>
        ) : (
          <div className="list__row srow">
            <Tile icon="plus" tone="plain" />
            <RowText title="Install app" sub="Use your browser’s menu → “Install app” (or “Add to Home screen”)." />
          </div>
        )}

        <div className="list__row srow srow--stack">
          <div className="row">
            <Tile icon="layers" tone="amber" />
            <RowText
              title="Storage"
              sub={storage ? `${formatBytes(storage.usage)} used of ${formatBytes(storage.quota)}` : 'Your log is stored on this device'}
            />
            {persisted !== undefined && <span className={`badge ${persisted ? 'badge--accent' : 'badge--amber'}`}>{persisted ? 'Protected' : 'Not protected'}</span>}
          </div>
          {storage && (
            <div className="sbar" aria-hidden>
              <span style={{ width: `${Math.min(100, usagePct)}%` }} />
            </div>
          )}
          <p className="srow__sub">
            Browsers can clear a site’s data when the device runs low on space. Protecting your data asks the browser to keep your flight log. Exporting a backup now and then is still the safest thing to do.
          </p>
          {persisted === false && (
            <button type="button" className="btn" onClick={() => void protect()}>
              Protect my data
            </button>
          )}
        </div>
      </Group>

      {/* ---------------------------------------------------------------- */}
      <Group title="Danger zone">
        <button type="button" className="list__row srow" onClick={() => setConfirm('delete')} disabled={count === 0}>
          <Tile icon="trash" tone="danger" />
          <RowText title="Delete all flights" sub={count ? `Permanently removes ${count.toLocaleString()} ${count === 1 ? 'flight' : 'flights'} from this device` : 'Your log is empty'} />
        </button>
      </Group>

      <Group title="Try it out" footer="Loads about 250 made-up flights so you can explore stats and the map. It replaces your current log.">
        <button type="button" className="list__row srow" onClick={() => setConfirm('sample')}>
          <Tile icon="sparkle" tone="amber" />
          <RowText title="Load sample data" sub="Demo flights from 2015 to today" />
        </button>
      </Group>

      {/* ---------------------------------------------------------------- */}
      <section className="sgroup">
        <h2 className="section-title sgroup__title">About</h2>
        <div className="card sabout">
          <div className="sabout__head">
            <img src={`${import.meta.env.BASE_URL}favicon.svg`} width="44" height="44" alt="" />
            <div>
              <div className="sabout__name">FlightJournal</div>
              <div className="srow__sub">Your flights, kept on your device. Optional account sync.</div>
            </div>
          </div>
          <h3 className="sabout__h">Data & attribution</h3>
          <ul className="sabout__list">
            <li>
              <a href="https://ourairports.com/data/" target="_blank" rel="noopener noreferrer">OurAirports</a> — airports and time zones (public domain)
            </li>
            <li>
              <a href="https://openflights.org/data.html" target="_blank" rel="noopener noreferrer">OpenFlights</a> — airlines and aircraft types (Open Database License)
            </li>
            <li>
              <a href="https://www.naturalearthdata.com/" target="_blank" rel="noopener noreferrer">Natural Earth</a> — world map shapes (public domain)
            </li>
            <li>
              <a href="https://www.adsbdb.com/" target="_blank" rel="noopener noreferrer">adsbdb</a> — free route lookups
            </li>
            <li>
              <a href="https://rapidapi.com/aedbx-aedbx/api/aerodatabox" target="_blank" rel="noopener noreferrer">AeroDataBox</a> — optional schedule lookups
            </li>
            <li>
              Airline logos via <a href="https://pics.avs.io/" target="_blank" rel="noopener noreferrer">pics.avs.io</a>
            </li>
            <li>
              Map tiles by <a href="https://openfreemap.org/" target="_blank" rel="noopener noreferrer">OpenFreeMap</a>, © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors
            </li>
          </ul>
          <p className="srow__sub">Not affiliated with Flightradar24. Import works from the CSV export of your own My Flights list.</p>
        </div>
      </section>

      <ConfirmSheet
        open={confirm === 'delete'}
        title="Delete all flights?"
        confirmLabel="Delete everything"
        icon="trash"
        danger
        requireText="DELETE"
        busy={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={() => void runConfirmed()}
      >
        <p>
          This permanently removes <strong>{count.toLocaleString()}</strong> {count === 1 ? 'flight' : 'flights'} from this device. It can’t be undone — export a backup first if you might want them back.
        </p>
        {syncing && <p>Cloud sync is on, so they’ll also be removed from your other devices. The cloud keeps deleted flights as recoverable records.</p>}
      </ConfirmSheet>
      <ConfirmSheet
        open={confirm === 'sample'}
        title="Load sample data?"
        confirmLabel="Replace with samples"
        icon="sparkle"
        danger={count > 0}
        requireText={count > 0 ? 'REPLACE' : undefined}
        busy={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={() => void runConfirmed()}
      >
        <p>
          This replaces your {count ? <><strong>{count.toLocaleString()}</strong> current {count === 1 ? 'flight' : 'flights'}</> : 'log'} with about 250 made-up flights. Export a backup first if you want to keep what you have.
        </p>
        {syncing && <p>Cloud sync is on — the samples will replace your log on every signed-in device too.</p>}
      </ConfirmSheet>
    </div>
  );
}
