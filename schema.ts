import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
export const organizations = sqliteTable("organizations", {
  id: text().primaryKey(),
  name: text().notNull(),
  profile: text().notNull(),
  revision: integer().notNull().default(1),
});
export const entries = sqliteTable("entries", {
  id: text().primaryKey(),
  organization: text()
    .notNull()
    .references(() => organizations.id),
  kind: text().notNull(),
  stamp: text().notNull(),
  author: text().notNull(),
  body: text().notNull(),
});
