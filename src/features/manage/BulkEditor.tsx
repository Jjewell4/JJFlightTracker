import { useSheetClose } from '@/components/useSheetClose';
import { popOverlayEntries } from '@/components/useBackDismiss';
import { useMemo, useState } from 'react';
import { Sheet, ConfirmSheet } from '@/components/Sheet';
import { getAirline } from '@/data/reference';
import { bulkUpdateFlights, deleteFlights, saveTrip } from '@/lib/db';
import { occasionFields } from '@/lib/occasions';
import type { Flight, FlightOccasion } from '@/lib/types';
import { OccasionPicker } from '@/features/trips/OccasionPicker';
import './manage.css';

export function BulkEditor({ ids, flights, onClose }: { ids: string[]; flights: Flight[]; onClose: () => void }) {
  const close = useSheetClose(onClose);
  const [action, setAction] = useState('trip');
  const [trip, setTrip] = useState('new');
  const [name, setName] = useState('');
  const [airline, setAirline] = useState('');
  const [occasions, setOccasions] = useState<FlightOccasion[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const trips = useMemo(
    () => [...new Map(flights.filter((f) => f.tripId).map((f) => [f.tripId!, f.tripName || 'Untitled trip'])).entries()],
    [flights],
  );
  const apply = async () => {
    setBusy(true);
    setError('');
    try {
      if (action === 'trip') {
        if (trip === 'new') {
          if (!name.trim()) throw new Error('Give the new trip a name');
          await saveTrip(ids, name);
        } else
          await bulkUpdateFlights(
            ids,
            { tripId: trip || undefined, tripName: flights.find((f) => f.tripId === trip && f.tripName)?.tripName },
            trip ? 'Move flights to trip' : 'Remove flights from trip',
          );
      } else if (action === 'occasions') await bulkUpdateFlights(ids, occasionFields(occasions), 'Change occasions');
      else if (action === 'airline') {
        const a = getAirline(airline.trim().toUpperCase());
        if (!a) throw new Error('Enter a recognized airline code, such as UA or UAL');
        await bulkUpdateFlights(ids, { airlineIcao: a.icao, airlineIata: a.iata, airlineName: a.name }, 'Correct airline');
      } else {
        // Deleting the final leg unmounts the page; finish overlay navigation first.
        await popOverlayEntries();
        await deleteFlights(ids);
      }
      if (action !== 'delete') await popOverlayEntries();
      await close();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save changes');
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  };
  return (
    <>
      <Sheet open onClose={() => void close()} labelledBy="bulk-title" dismissible={!busy}>
        <h2 id="bulk-title">
          Edit {ids.length} {ids.length === 1 ? 'flight' : 'flights'}
        </h2>
        <p className="manage-hint">Changes save on this device immediately. Undo them in History & recovery.</p>
        <label className="manage-field">
          Action
          <select aria-label="Action" className="input" value={action} onChange={(e) => setAction(e.target.value)}>
            <option value="trip">Group or move to a trip</option>
            <option value="occasions">Change occasions</option>
            <option value="airline">Correct airline</option>
            <option value="delete">Delete flights</option>
          </select>
        </label>
        {action === 'trip' && (
          <>
            <label className="manage-field">
              Destination trip
              <select aria-label="Destination trip" className="input" value={trip} onChange={(e) => setTrip(e.target.value)}>
                <option value="new">Create a new trip / split selection</option>
                <option value="">Remove trip grouping</option>
                {trips.map(([id, title]) => (
                  <option key={id} value={id}>
                    {title} ·{' '}
                    {
                      flights
                        .filter((f) => f.tripId === id)
                        .map((f) => f.date)
                        .sort()[0]
                    }
                  </option>
                ))}
              </select>
            </label>
            {trip === 'new' && (
              <label className="manage-field">
                Trip name
                <input className="input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
              </label>
            )}
            <p className="manage-hint">Select all legs from two trips to combine them, or just a few legs to split them into a new trip.</p>
          </>
        )}
        {action === 'occasions' && (
          <>
            <OccasionPicker value={occasions} onChange={setOccasions} />
            <p className="manage-hint">Replaces the occasions on selected flights. Leave both unselected to clear them.</p>
          </>
        )}
        {action === 'airline' && (
          <label className="manage-field">
            Airline code
            <input
              className="input"
              value={airline}
              onChange={(e) => setAirline(e.target.value)}
              placeholder="UA or UAL"
              maxLength={3}
              autoCapitalize="characters"
            />
          </label>
        )}
        {action === 'delete' && (
          <p className="manage-hint">Flights leave your log and synced devices. A recovery copy stays on this device.</p>
        )}
        {error && <p role="alert">{error}</p>}
        <button
          className="btn btn--primary btn--block"
          disabled={busy || !ids.length}
          onClick={() => (action === 'delete' ? setConfirm(true) : void apply())}
        >
          {busy ? 'Saving…' : 'Apply changes'}
        </button>
      </Sheet>
      <ConfirmSheet
        open={confirm}
        onCancel={() => setConfirm(false)}
        title="Delete selected flights?"
        message={`${ids.length} flights will leave your log. You can restore them from History & recovery on this device.`}
        confirmLabel="Delete flights"
        onConfirm={() => void apply()}
        busy={busy}
      />
    </>
  );
}
