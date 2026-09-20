CREATE TABLE `api_cache` (
	`key` text PRIMARY KEY,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `collector_state` (
	`id` integer PRIMARY KEY,
	`run_id` text,
	`lease_until` integer DEFAULT 0 NOT NULL,
	`last_scheduled_at` integer DEFAULT 0 NOT NULL,
	`first_collected_at` integer,
	`last_collected_at` integer,
	`last_attempt_at` integer,
	`state` text DEFAULT 'unconfigured' NOT NULL,
	`error` text,
	CONSTRAINT "collector_singleton" CHECK("id" = 1)
);
--> statement-breakpoint
CREATE TABLE `daily_stats` (
	`twitch_id` text NOT NULL,
	`day` integer NOT NULL,
	`duration_seconds` real DEFAULT 0 NOT NULL,
	`viewer_seconds` real DEFAULT 0 NOT NULL,
	`peak_viewers` integer DEFAULT 0 NOT NULL,
	CONSTRAINT `daily_stats_pk` PRIMARY KEY(`twitch_id`, `day`),
	CONSTRAINT `fk_daily_stats_twitch_id_streamers_twitch_id_fk` FOREIGN KEY (`twitch_id`) REFERENCES `streamers`(`twitch_id`)
);
--> statement-breakpoint
CREATE TABLE `hourly_stats` (
	`twitch_id` text NOT NULL,
	`hour` integer NOT NULL,
	`duration_seconds` real DEFAULT 0 NOT NULL,
	CONSTRAINT `hourly_stats_pk` PRIMARY KEY(`twitch_id`, `hour`),
	CONSTRAINT `fk_hourly_stats_twitch_id_streamers_twitch_id_fk` FOREIGN KEY (`twitch_id`) REFERENCES `streamers`(`twitch_id`)
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY,
	`twitch_id` text NOT NULL,
	`twitch_stream_id` text NOT NULL,
	`title` text NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`duration_seconds` real DEFAULT 0 NOT NULL,
	`viewer_seconds` real DEFAULT 0 NOT NULL,
	`peak_viewers` integer DEFAULT 0 NOT NULL,
	CONSTRAINT `fk_sessions_twitch_id_streamers_twitch_id_fk` FOREIGN KEY (`twitch_id`) REFERENCES `streamers`(`twitch_id`)
);
--> statement-breakpoint
CREATE TABLE `streamers` (
	`twitch_id` text PRIMARY KEY,
	`login` text DEFAULT '' NOT NULL,
	`display_name` text DEFAULT '' NOT NULL,
	`profile_image_url` text,
	`profile_updated_at` integer,
	`first_seen_at` integer,
	`last_observed_at` integer DEFAULT 0 NOT NULL,
	`is_live` integer DEFAULT false NOT NULL,
	`session_id` text,
	`twitch_stream_id` text,
	`last_seen_at` integer,
	`live_started_at` integer,
	`live_viewer_count` integer,
	`title` text,
	`thumbnail_url` text,
	`duration_seconds` real DEFAULT 0 NOT NULL,
	`viewer_seconds` real DEFAULT 0 NOT NULL,
	`peak_viewers` integer DEFAULT 0 NOT NULL,
	`average_viewers` real GENERATED ALWAYS AS (CASE WHEN duration_seconds > 0 THEN viewer_seconds / duration_seconds ELSE 0 END) VIRTUAL,
	`steam_account_id` integer UNIQUE,
	`rank_tier` integer,
	`rank_subrank` integer,
	`rank_updated_at` integer,
	`rank_unavailable` integer DEFAULT false NOT NULL,
	`rank_score` integer GENERATED ALWAYS AS (CASE WHEN rank_tier > 0 THEN rank_tier * 10 + rank_subrank WHEN rank_tier = 0 THEN 0 ELSE -1 END) VIRTUAL,
	`rank_asc_score` integer GENERATED ALWAYS AS (CASE WHEN rank_tier > 0 THEN 200 - rank_tier * 10 - rank_subrank WHEN rank_tier = 0 THEN 0 ELSE -1 END) VIRTUAL,
	`match_time_seconds` integer,
	`match_time_updated_at` integer,
	`recent_matches` text DEFAULT '[]' NOT NULL,
	`history_updated_at` integer,
	`enrichment_due_at` integer DEFAULT 0 NOT NULL,
	`enrichment_failures` integer DEFAULT 0 NOT NULL,
	`enrichment_error` text,
	CONSTRAINT "positive_metrics" CHECK("duration_seconds" >= 0 AND "viewer_seconds" >= 0 AND "peak_viewers" >= 0),
	CONSTRAINT "steam_account_range" CHECK("steam_account_id" > 0 AND "steam_account_id" <= 4294967295),
	CONSTRAINT "rank_range" CHECK(("rank_tier" IS NULL AND "rank_subrank" IS NULL) OR ("rank_tier" = 0 AND "rank_subrank" = 0) OR ("rank_tier" BETWEEN 1 AND 11 AND "rank_subrank" BETWEEN 1 AND 6))
);
--> statement-breakpoint
CREATE INDEX `sessions_recent` ON `sessions` (`twitch_id`,"started_at" desc,`id`);--> statement-breakpoint
CREATE INDEX `streamers_live` ON `streamers` ("is_live" desc,"viewer_seconds" desc,`twitch_id`) WHERE "streamers"."first_seen_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `streamers_duration_seconds` ON `streamers` ("duration_seconds" desc,`twitch_id`) WHERE "streamers"."first_seen_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `streamers_viewer_seconds` ON `streamers` ("viewer_seconds" desc,`twitch_id`) WHERE "streamers"."first_seen_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `streamers_average_viewers` ON `streamers` ("average_viewers" desc,`twitch_id`) WHERE "streamers"."first_seen_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `streamers_peak_viewers` ON `streamers` ("peak_viewers" desc,`twitch_id`) WHERE "streamers"."first_seen_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `streamers_rank_score` ON `streamers` ("rank_score" desc,`twitch_id`) WHERE "streamers"."first_seen_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `streamers_rank_asc_score` ON `streamers` ("rank_asc_score" desc,`twitch_id`) WHERE "streamers"."first_seen_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `streamers_match_time_seconds` ON `streamers` ("match_time_seconds" desc,`twitch_id`) WHERE "streamers"."first_seen_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `streamers_enrichment` ON `streamers` (`enrichment_due_at`) WHERE "streamers"."steam_account_id" IS NOT NULL;