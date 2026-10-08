// One morning publication; collection continues quietly throughout the day.
import cron from 'node-cron';
import { TZ } from './publication.ts';

export { TZ } from './publication.ts';

export const SLOTS: [number, number][] = [[10, 0]];

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
      // Also collect at publication time, including after a recent restart.
      if (poll) await poll();
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

  // Collection sends no messages and keeps fast feeds from losing stories.
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
