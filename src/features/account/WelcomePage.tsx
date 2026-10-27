import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '@/components/Icon';
import { useFlights } from '@/lib/db';
import { useCloudSync } from '@/services/sync/controller';
import { Benefits } from './AccountPage';
import { markOnboarded } from './onboarding';
import { SignInPanel } from './SignInPanel';
import './account.css';

/** First-run screen: sign in for backup & sync, or continue on this device only. */
export default function WelcomePage() {
  const sync = useCloudSync();
  const flights = useFlights();
  const navigate = useNavigate();
  const [step, setStep] = useState<'choose' | 'signin'>('choose');
  const count = flights?.length ?? 0;

  const finish = () => {
    markOnboarded();
    navigate('/', { replace: true });
  };

  // Signed in (here, or by opening the email link in another tab) → straight to the app.
  useEffect(() => {
    if (sync.phase === 'signed-in' || sync.phase === 'disabled') finish();
  }, [sync.phase]);

  return (
    <div className="welcome">
      <div className="welcome__inner animate-in">
        <div className="welcome__brand">
          <span className="welcome__logo" aria-hidden>
            <Icon name="plane" size={34} />
          </span>
          <h1 className="welcome__title">Flight Log</h1>
          <p className="welcome__tagline">Every flight, route and mile — beautifully kept.</p>
        </div>

        {step === 'choose' ? (
          <section className="card welcome__card">
            <h2 className="account-card__title">{count > 0 ? `Keep your ${count.toLocaleString()} flights safe` : 'How do you want to start?'}</h2>
            <Benefits />
            <div className="welcome__actions">
              <button type="button" className="btn btn--primary btn--lg btn--block" onClick={() => setStep('signin')}>
                <Icon name="mail" size={18} /> Sign in with email
              </button>
              <button type="button" className="btn btn--ghost btn--lg btn--block" onClick={finish}>
                Continue without an account
              </button>
            </div>
            <p className="field__hint welcome__note">No password — we email you a link. You can sign in later from the account button in the top corner.</p>
          </section>
        ) : (
          <section className="card welcome__card">
            <h2 className="account-card__title">Sign in or create an account</h2>
            <p className="muted welcome__lead">Enter your email. If you’re new, this creates your free account.</p>
            <SignInPanel autoFocus />
            <button type="button" className="btn btn--ghost btn--block welcome__skip" onClick={finish}>
              Not now — continue without an account
            </button>
          </section>
        )}
      </div>
    </div>
  );
}
