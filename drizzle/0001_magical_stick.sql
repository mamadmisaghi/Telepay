CREATE TABLE `sandbox_telegram` (
	`nonce_hash` text PRIMARY KEY NOT NULL,
	`wallet` text NOT NULL,
	`expires` integer NOT NULL,
	`telegram_id` text,
	`handle` text,
	`verified_at` integer,
	`consumed` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sandbox_telegram_wallet` ON `sandbox_telegram` (`wallet`,`verified_at`);