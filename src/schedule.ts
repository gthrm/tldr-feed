// Ten slots between 09:00 and 21:00, evenly spaced every 80 minutes.
// Europe/Belgrade is CET and handles the summer-time shift by itself.
import cron from 'node-cron';

export const TZ = process.env.TZ_NAME ?? 'Europe/Belgrade';

export const SLOTS: [number, number][] = [
  [9, 0],
  [10, 20],
  [11, 40],
  [13, 0],
  [14, 20],
  [15, 40],
  [17, 0],
  [18, 20],
  [19, 40],
  [21, 0],
];

export const POLL_MINUTES = Number(process.env.POLL_MINUTES ?? 20);

export function startSchedule(run: () => Promise<void>, poll?: () => Promise<void>): void {
  let running = false;

  const guarded = async (label: string) => {
    if (running) {
      console.log(new Date().toISOString(), `${label}: previous run still going, skipped`);
      return;
    }
    running = true;
    try {
      await run();
    } catch (err) {
      console.error(new Date().toISOString(), `${label} failed:`, err);
    } finally {
      running = false;
    }
  };

  for (const [h, m] of SLOTS) {
    cron.schedule(
      `${m} ${h} * * *`,
      () => {
        void guarded(`slot ${h}:${String(m).padStart(2, '0')}`);
      },
      { timezone: TZ },
    );
  }

  // Collection runs far more often than publishing, so nothing falls out of a
  // fast feed unseen between two slots.
  if (poll) {
    let polling = false;
    cron.schedule(
      `*/${POLL_MINUTES} * * * *`,
      () => {
        if (polling) return;
        polling = true;
        void poll()
          .catch((err: unknown) => {
            console.error(new Date().toISOString(), 'poll failed:', err);
          })
          .finally(() => {
            polling = false;
          });
      },
      { timezone: TZ },
    );
  }
}
