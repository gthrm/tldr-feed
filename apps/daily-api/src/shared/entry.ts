/** One story on a day's page: what the Telegram bot posted, as stored in `digest`. */
export type DayEntry = {
  day: string;
  publishedAt: Date;
  slot: string;
  section: string;
  title: string;
  url: string;
  domain: string;
  summary: string;
  minutes: number;
  position: number;
};
