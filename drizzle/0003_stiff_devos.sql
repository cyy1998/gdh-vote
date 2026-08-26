DROP INDEX `ballot_election_sequence`;--> statement-breakpoint
CREATE UNIQUE INDEX `ballot_active_election_sequence` ON `ballot_record` (`election_id`,`sequence`) WHERE "ballot_record"."status" = 'active';--> statement-breakpoint
ALTER TABLE `election_state` DROP COLUMN `next_sequence`;