CREATE TABLE `sandbox_challenges` (
	`id` text PRIMARY KEY NOT NULL,
	`wallet` text NOT NULL,
	`action` text NOT NULL,
	`digest` text NOT NULL,
	`message` text NOT NULL,
	`expires` integer NOT NULL,
	`used` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sandbox_challenge_wallet_expiry` ON `sandbox_challenges` (`wallet`,`expires`);--> statement-breakpoint
CREATE TABLE `sandbox_launches` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`wallet` text NOT NULL,
	`mint` text NOT NULL,
	`name` text NOT NULL,
	`symbol` text NOT NULL,
	`description` text NOT NULL,
	`handle` text NOT NULL,
	`image_type` text NOT NULL,
	`initial_buy` text NOT NULL,
	`credited` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sandbox_launch_mint` ON `sandbox_launches` (`mint`);--> statement-breakpoint
CREATE UNIQUE INDEX `sandbox_launch_request` ON `sandbox_launches` (`wallet`,`request_id`);--> statement-breakpoint
CREATE INDEX `sandbox_launch_wallet` ON `sandbox_launches` (`wallet`);--> statement-breakpoint
CREATE TABLE `sandbox_mints` (
	`address` text PRIMARY KEY NOT NULL,
	`launch_id` text
);
--> statement-breakpoint
CREATE TABLE `sandbox_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`launch_id` text NOT NULL,
	`kind` text NOT NULL,
	`wallet` text NOT NULL,
	`status` text NOT NULL,
	`message` text,
	`wire` text,
	`signature` text,
	`last_valid_height` integer,
	`amount` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`error` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sandbox_tx_kind` ON `sandbox_transactions` (`launch_id`,`kind`);--> statement-breakpoint
CREATE INDEX `sandbox_tx_status` ON `sandbox_transactions` (`status`);