import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/**
 * 基础设施元数据。当前只用于开发期 seed / schema 探针，
 * 不承载任何业务领域状态；业务表随第一个垂直切片再引入。
 */
export const appMeta = pgTable("app_meta", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<JsonValue>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const schema = {
  appMeta,
};

export type AppSchema = typeof schema;
