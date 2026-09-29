export type Entry = {
	slot: string;
	section: string;
	title: string;
	url: string;
	domain: string;
	summary: string;
	minutes: number;
};

export type Day = { day: string; builtAt?: string; entries: Entry[] };
export type ArchiveDay = { day: string; count: number };
