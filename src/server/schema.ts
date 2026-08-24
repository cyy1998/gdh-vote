import {
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const electionState = sqliteTable("election_state", {
  electionId: text("election_id").primaryKey(),
  nextSequence: integer("next_sequence").notNull().default(1),
  version: integer("version").notNull().default(1),
  generation: integer("generation").notNull().default(1),
});

export const ballotRecords = sqliteTable(
  "ballot_record",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    electionId: text("election_id").notNull(),
    sequence: integer("sequence").notNull(),
    groupId: text("group_id").notNull(),
    status: text("status").notNull().default("active"),
    valid: integer("valid", { mode: "boolean" }).notNull(),
    manualInvalid: integer("manual_invalid", { mode: "boolean" }).notNull(),
    submittedAt: text("submitted_at").notNull(),
    withdrawnAt: text("withdrawn_at"),
  },
  (table) => [
    uniqueIndex("ballot_election_sequence").on(
      table.electionId,
      table.sequence,
    ),
  ],
);

export const listedChoices = sqliteTable(
  "listed_choice",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    ballotId: integer("ballot_id")
      .notNull()
      .references(() => ballotRecords.id, { onDelete: "cascade" }),
    candidateName: text("candidate_name").notNull(),
    choice: text("choice").notNull(),
  },
  (table) => [
    uniqueIndex("listed_choice_ballot_candidate").on(
      table.ballotId,
      table.candidateName,
    ),
  ],
);

export const writeInChoices = sqliteTable(
  "write_in_choice",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    ballotId: integer("ballot_id")
      .notNull()
      .references(() => ballotRecords.id, { onDelete: "cascade" }),
    normalizedName: text("normalized_name").notNull(),
    displayName: text("display_name").notNull(),
  },
  (table) => [
    uniqueIndex("write_in_ballot_name").on(
      table.ballotId,
      table.normalizedName,
    ),
  ],
);
