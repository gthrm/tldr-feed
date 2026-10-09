// Collect three times a day, publish once: 10:00 collects and then publishes,
// 18:00 and 02:00 only collect, so fast feeds do not lose a day's stories.
import cron from 'node-cron';
import { TZ } from './publication.ts';

export { TZ } from './publication.ts';

export const SLOTS: [number, number][] = [[10, 0]];
/** Collection-only runs; the 10:00 publication collects for itself. */
export const POLLS = ['18:00', '02:00'];

export function startSchedule(run: () => Promise<void>, poll: () => Promise<void>): void {
  let running = false;

  const guarded = async (label: string, job: () => Promise<void>) => {
    if (running) {
      console.log(new Date().toISOString(), `${label}: previous run still going, skipped`);
      return;
    }
    running = true;
    try {
      await job();
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
        void guarded(`slot ${h}:${String(m).padStart(2, '0')}`, run);
      },
      { timezone: TZ },
    );
  }

  for (const at of POLLS) {
    const [h, m] = at.split(':').map(Number);
    cron.schedule(`${m} ${h} * * *`, () => void guarded(`poll ${at}`, poll), { timezone: TZ });
  }
}
