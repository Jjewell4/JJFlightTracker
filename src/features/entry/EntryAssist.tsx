import { useState } from 'react';
import { Icon } from '@/components/Icon';
import type { FormValues } from './form-model';
import { QuickEntry } from './QuickEntry';
import { ScreenshotImport, type DraftLegRef } from './ScreenshotImport';
import { useDrafts } from '@/services/screenshot/drafts';

/**
 * One compact row of shortcuts above the new-flight form. Each opens its flow in a bottom
 * sheet, so the form itself starts right below.
 */
export function EntryAssist({
  dirty,
  clock,
  onQuick,
  onScreenshot,
}: {
  dirty: boolean;
  clock: '12h' | '24h';
  onQuick: (values: Partial<FormValues>) => void;
  onScreenshot: (values: Partial<FormValues>, from: DraftLegRef) => void;
}) {
  const [open, setOpen] = useState<'scan' | 'quick' | null>(null);
  // Screenshots waiting in To review: a count on the pill (the sheet links to them).
  const waiting = useDrafts()?.length ?? 0;
  const close = () => setOpen(null);
  return (
    <>
      <div className="entry-assist" role="group" aria-label="Fill in faster">
        <button type="button" className="assist-pill" aria-haspopup="dialog" onClick={() => setOpen('scan')}>
          <Icon name="scan" size={18} />
          Scan screenshot
          {waiting > 0 && (
            <span className="assist-pill__count">
              {waiting}
              <span className="visually-hidden"> to review</span>
            </span>
          )}
        </button>
        <button type="button" className="assist-pill" aria-haspopup="dialog" onClick={() => setOpen('quick')}>
          <Icon name="keyboard" size={18} />
          Quick entry
        </button>
      </div>
      <ScreenshotImport
        open={open === 'scan'}
        onClose={close}
        clock={clock}
        onApply={(values, from) => {
          close();
          onScreenshot(values, from);
        }}
      />
      <QuickEntry
        open={open === 'quick'}
        onClose={close}
        dirty={dirty}
        onApply={(values) => {
          close();
          onQuick(values);
        }}
      />
    </>
  );
}
