CREATE TABLE `ballot_record` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`election_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`group_id` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`valid` integer NOT NULL,
	`manual_invalid` integer NOT NULL,
	`submitted_at` text NOT NULL,
	`withdrawn_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ballot_election_sequence` ON `ballot_record` (`election_id`,`sequence`);--> statement-breakpoint
CREATE TABLE `election_state` (
	`election_id` text PRIMARY KEY NOT NULL,
	`next_sequence` integer DEFAULT 1 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `listed_choice` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ballot_id` integer NOT NULL,
	`candidate_name` text NOT NULL,
	`choice` text NOT NULL,
	FOREIGN KEY (`ballot_id`) REFERENCES `ballot_record`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `listed_choice_ballot_candidate` ON `listed_choice` (`ballot_id`,`candidate_name`);--> statement-breakpoint
CREATE TABLE `write_in_choice` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ballot_id` integer NOT NULL,
	`normalized_name` text NOT NULL,
	`display_name` text NOT NULL,
	FOREIGN KEY (`ballot_id`) REFERENCES `ballot_record`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `write_in_ballot_name` ON `write_in_choice` (`ballot_id`,`normalized_name`);