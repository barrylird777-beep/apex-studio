import { relations } from "drizzle-orm";
import { pgTable, serial, text, integer, real, timestamp, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";

export const projects = pgTable("projects", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  primaryScripture: text("primary_scripture"),
  status: text("status").default("development"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const characters = pgTable("characters", {
  id: serial("id").primaryKey(),
  canonicalName: text("canonical_name").notNull(),
  aliases: jsonb("aliases").$type<string[]>().default([]),
  primaryStories: jsonb("primary_stories").$type<string[]>().default([]),
  relationships: jsonb("relationships").$type<{ name: string; relation: string }[]>().default([]),
  keyTraits: jsonb("key_traits").$type<string[]>().default([]),
  notes: text("notes"),
  scriptureReferences: jsonb("scripture_references").$type<string[]>().default([]),
}, (table) => ({
  canonicalNameUnique: uniqueIndex("characters_canonical_name_unique").on(table.canonicalName),
}));

export const scenes = pgTable("scenes", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").references(() => projects.id, { onDelete: "cascade" }).notNull(),
  sceneNumber: integer("scene_number"),
  title: text("title"),
  scriptureRef: text("scripture_ref").notNull(),
  location: text("location"),
  charactersPresent: jsonb("characters_present").$type<number[]>().default([]),
  actionSummary: text("action_summary"),
  emotionalBeat: text("emotional_beat"),
  productionNotes: text("production_notes"),
  estimatedPages: real("estimated_pages"),
  dayOrNight: text("day_or_night"),
});

export const shootDays = pgTable("shoot_days", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").references(() => projects.id, { onDelete: "cascade" }).notNull(),
  date: text("date").notNull(),
  callTime: text("call_time"),
  unit: text("unit").default("1st Unit"),
  notes: text("notes"),
}, (table) => ({
  projectDateUnique: uniqueIndex("shoot_days_project_date_unique").on(table.projectId, table.date),
  projectDateIndex: index("shoot_days_project_date_idx").on(table.projectId, table.date),
}));

export const shootDayScenes = pgTable("shoot_day_scenes", {
  sceneId: integer("scene_id").primaryKey().references(() => scenes.id, { onDelete: "cascade" }),
  shootDayId: integer("shoot_day_id").references(() => shootDays.id, { onDelete: "cascade" }).notNull(),
  position: integer("position").notNull(),
}, (table) => ({
  dayPositionIndex: index("shoot_day_scenes_day_position_idx").on(table.shootDayId, table.position),
}));

export const callSheets = pgTable("call_sheets", {
  id: serial("id").primaryKey(),
  shootDayId: integer("shoot_day_id").references(() => shootDays.id, { onDelete: "cascade" }).notNull(),
  generalCallTime: text("general_call_time"),
  weatherNotes: text("weather_notes"),
  specialRequirements: text("special_requirements"),
  pdfPath: text("pdf_path"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const budgetItems = pgTable("budget_items", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").references(() => projects.id, { onDelete: "cascade" }).notNull(),
  category: text("category").notNull(),
  description: text("description").notNull(),
  estimated: real("estimated").default(0),
  actual: real("actual").default(0),
  notes: text("notes"),
});

export const projectsRelations = relations(projects, ({ many }) => ({
  scenes: many(scenes),
  shootDays: many(shootDays),
  budgetItems: many(budgetItems),
}));

export const scenesRelations = relations(scenes, ({ one, many }) => ({
  project: one(projects, { fields: [scenes.projectId], references: [projects.id] }),
  shootDayAssignments: many(shootDayScenes),
}));

export const shootDaysRelations = relations(shootDays, ({ one, many }) => ({
  project: one(projects, { fields: [shootDays.projectId], references: [projects.id] }),
  callSheets: many(callSheets),
  scenes: many(shootDayScenes),
}));

export const shootDayScenesRelations = relations(shootDayScenes, ({ one }) => ({
  scene: one(scenes, { fields: [shootDayScenes.sceneId], references: [scenes.id] }),
  shootDay: one(shootDays, { fields: [shootDayScenes.shootDayId], references: [shootDays.id] }),
}));