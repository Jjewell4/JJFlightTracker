import { lazy, Suspense } from 'react';
import { HashRouter, Route, Routes } from 'react-router-dom';
import { AppShell } from '@/components/AppShell';
import { ThemeController } from '@/components/ThemeController';
import { PageLoader } from '@/components/PageLoader';
import { FlightsPage } from '@/features/flights/FlightsPage';

// Heavier screens are code-split; the flights list is the landing screen.
const FlightDetailPage = lazy(() => import('@/features/flights/FlightDetailPage'));
const FlightFormPage = lazy(() => import('@/features/entry/FlightFormPage'));
const MapPage = lazy(() => import('@/features/map/MapPage'));
const StatsPage = lazy(() => import('@/features/stats/StatsPage'));
const ImportPage = lazy(() => import('@/features/import/ImportPage'));
const SettingsPage = lazy(() => import('@/features/settings/SettingsPage'));

export function App() {
  return (
    <HashRouter>
      <ThemeController />
      <AppShell>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/" element={<FlightsPage />} />
            <Route path="/flights/new" element={<FlightFormPage />} />
            <Route path="/flights/:id" element={<FlightDetailPage />} />
            <Route path="/flights/:id/edit" element={<FlightFormPage />} />
            <Route path="/map" element={<MapPage />} />
            <Route path="/stats" element={<StatsPage />} />
            <Route path="/import" element={<ImportPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<FlightsPage />} />
          </Routes>
        </Suspense>
      </AppShell>
    </HashRouter>
  );
}
