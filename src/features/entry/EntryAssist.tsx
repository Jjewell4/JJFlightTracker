import { useState } from 'react';
import { Icon } from '@/components/Icon';
import type { FormValues } from './form-model';
import { QuickEntry } from './QuickEntry';
import { ScreenshotImport } from './ScreenshotImport';

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
  onScreenshot: (values: Partial<FormValues>) => void;
}) {
  const [open, setOpen] = useState<'scan' | 'quick' | null>(null);
  const close = () => setOpen(null);
  return (
    <>
      <div className="entry-assist" role="group" aria-label="Fill in faster">
        <button type="button" className="assist-pill" aria-haspopup="dialog" onClick={() => setOpen('scan')}>
          <Icon name="scan" size={18} />
          Scan screenshot
        </button>
        <button type="button" className="assist-pill" aria-haspopup="dialog" onClick={() => setOpen('quick')}>
          <Icon name="keyboard" size={18} />
          Quick entry
        </button>
      </div>
      <ScreenshotImport
        open={open === 'scan'}
        onClose={close}
        dirty={dirty}
        clock={clock}
        onApply={(values) => {
          close();
          onScreenshot(values);
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
