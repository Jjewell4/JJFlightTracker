import { lazy, Suspense } from 'react';
import { HashRouter, Route, Routes } from 'react-router-dom';
import { AirlineLogoPrefs } from '@/components/airline-logo-prefs';
import { AppShell } from '@/components/AppShell';
import { RouteErrorBoundary } from '@/components/ErrorBoundary';
import { ThemeController } from '@/components/ThemeController';
import { PageLoader } from '@/components/PageLoader';
import { PwaPrompts } from '@/components/PwaPrompts';
import { publicHandleFromPath } from '@/features/public/profile';
import { FlightsPage } from '@/features/flights/FlightsPage';

// Heavier screens are code-split; the flights list is the landing screen.
const PublicProfilePage = lazy(() => import('@/features/public/PublicProfilePage'));
const FlightDetailPage = lazy(() => import('@/features/flights/FlightDetailPage'));
const FlightFormPage = lazy(() => import('@/features/entry/FlightFormPage'));
const MapPage = lazy(() => import('@/features/map/MapPage'));
const StatsPage = lazy(() => import('@/features/stats/StatsPage'));
const ImportPage = lazy(() => import('@/features/import/ImportPage'));
const SettingsPage = lazy(() => import('@/features/settings/SettingsPage'));
const PasswordPage = lazy(() => import('@/features/account/PasswordPage'));
const AccountPage = lazy(() => import('@/features/account/AccountPage'));
const WelcomePage = lazy(() => import('@/features/account/WelcomePage'));
const TripPage = lazy(() => import('@/features/trips/TripPage'));
const ReviewPage = lazy(() => import('@/features/review/ReviewPage'));
const AirportPage = lazy(() => import('@/features/explore/AirportPage'));
const AirlinePage = lazy(() => import('@/features/explore/AirlinePage'));

export function App() {
  const publicHandle = publicHandleFromPath(window.location.pathname);
  if (publicHandle) return <><ThemeController /><Suspense fallback={<PageLoader />}><PublicProfilePage slug={publicHandle}/></Suspense></>;
  return (
    <HashRouter>
      <ThemeController />
      <AirlineLogoPrefs />
      <PwaPrompts />
      <AppShell>
        <RouteErrorBoundary>
          <Suspense fallback={<PageLoader />}>
            <Routes>
              <Route path="/" element={<FlightsPage />} />
              <Route path="/flights" element={<FlightsPage />} />
              <Route path="/flights/new" element={<FlightFormPage />} />
              <Route path="/flights/:id" element={<FlightDetailPage />} />
              <Route path="/flights/:id/edit" element={<FlightFormPage />} />
              <Route path="/trips/:id" element={<TripPage />} />
              <Route path="/review" element={<ReviewPage />} />
              <Route path="/review/:id" element={<ReviewPage />} />
              <Route path="/airports/:ident" element={<AirportPage />} />
              <Route path="/airlines/:key" element={<AirlinePage />} />
              <Route path="/map" element={<MapPage />} />
              <Route path="/stats" element={<StatsPage />} />
              <Route path="/import" element={<ImportPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/password" element={<PasswordPage />} />
              <Route path="/account" element={<AccountPage />} />
              <Route path="/welcome" element={<WelcomePage />} />
              <Route path="*" element={<FlightsPage />} />
            </Routes>
          </Suspense>
        </RouteErrorBoundary>
      </AppShell>
    </HashRouter>
  );
}
