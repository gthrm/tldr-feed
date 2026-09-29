CREATE TABLE "digest" (
	"id" serial PRIMARY KEY NOT NULL,
	"day" date NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"slot" varchar(5) NOT NULL,
	"section" varchar(32) NOT NULL,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"domain" text NOT NULL,
	"summary" text NOT NULL,
	"minutes" integer NOT NULL,
	"position" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mail_log" (
	"day" date NOT NULL,
	"email" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_log_day_email_pk" PRIMARY KEY("day","email")
);
--> statement-breakpoint
CREATE TABLE "subscribers" (
	"email" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"status" varchar(16) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone,
	"unsubscribed_at" timestamp with time zone,
	CONSTRAINT "subscribers_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "digest_day_url" ON "digest" USING btree ("day","url");--> statement-breakpoint
CREATE INDEX "digest_day" ON "digest" USING btree ("day");