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
  visualDna: jsonb("visual_dna").$type<Record<string, unknown>>().default({}),
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
  shootDayId: integer("shoot_day_id").references(() => shootDays.id, { onDelete: "cascade" }),
  projectId: integer("project_id").references(() => projects.id, { onDelete: "cascade" }),
  shootDate: text("shoot_date"),
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
  crew: jsonb("crew").$type<string[]>().default([]),
  cast: jsonb("cast").$type<string[]>().default([]),
  locations: jsonb("locations").$type<string[]>().default([]),
  characters: jsonb("characters").$type<number[]>().default([]),
  callTimes: jsonb("call_times").$type<Record<string, string>>().default({}),
  sceneIds: jsonb("scene_ids").$type<number[]>().default([]),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
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
}));\nexport const scriptNotes = pgTable("script_notes", {\n  id: serial("id").primaryKey(),\n  projectId: integer("project_id").references(() => projects.id, { onDelete: "cascade" }).notNull(),\n  sceneId: integer("scene_id").references(() => scenes.id, { onDelete: "set null" }),\n  scriptureRef: text("scripture_ref").notNull(),\n  dialogue: text("dialogue"),\n  versionNotes: text("version_notes"),\n});\n\nexport const sceneArtifacts = pgTable("scene_artifacts", {\n  id: serial("id").primaryKey(),\n  projectId: integer("project_id").references(() => projects.id, { onDelete: "cascade" }).notNull(),\n  sceneId: integer("scene_id").references(() => scenes.id, { onDelete: "cascade" }).notNull(),\n  artifactType: text("artifact_type").notNull(),\n  storagePath: text("storage_path").notNull(),\n  contentHash: text("content_hash").notNull(),\n  lineage: jsonb("lineage").default({}),\n  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),\n  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),\n}, (table) => ({\n  contentHashUnique: uniqueIndex("scene_artifacts_content_hash_unique").on(table.contentHash),\n  projectSceneTypeIndex: index("scene_artifacts_project_scene_type_idx").on(table.projectId, table.sceneId, table.artifactType),\n}));\n


export const shots = pgTable("shots", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").references(() => projects.id, { onDelete: "cascade" }).notNull(),
  sceneId: integer("scene_id").references(() => scenes.id, { onDelete: "cascade" }).notNull(),
  shotIndex: integer("shot_index").notNull(),
  prompt: text("prompt").notNull(),
  durationFrames: integer("duration_frames").notNull().default(72),
  status: text("status").notNull().default("planned"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
}, (table) => ({
  sceneShotUnique: uniqueIndex("shots_scene_shot_unique").on(table.sceneId, table.shotIndex),
  projectSceneIndex: index("shots_project_scene_idx").on(table.projectId, table.sceneId),
}));

export const protocobs = pgTable("protocobs", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").references(() => projects.id, { onDelete: "cascade" }).notNull(),
  sceneId: integer("scene_id").references(() => scenes.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  concept: text("concept").notNull(),
  prompt: text("prompt"),
  visualDna: jsonb("visual_dna").default({}),
  artifactPath: text("artifact_path"),
  status: text("status").notNull().default("pending"),
  cornNuts: integer("corn_nuts"),
  createdBy: text("created_by").notNull().default("cob"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
}, (table) => ({
  projectStatusIndex: index("protocobs_project_status_idx").on(table.projectId, table.status),
}));

export const productionApprovals = pgTable("production_approvals", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").references(() => projects.id, { onDelete: "cascade" }).notNull(),
  protocobId: integer("protocob_id").references(() => protocobs.id, { onDelete: "cascade" }),
  artifactId: integer("artifact_id").references(() => sceneArtifacts.id, { onDelete: "cascade" }),
  action: text("action").notNull(),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const bibleCollections = pgTable("bible_collections", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  ownerKey: text("owner_key").notNull().default("owner"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
}, (table) => ({
  ownerNameUnique: uniqueIndex("bible_collections_owner_name_unique").on(table.ownerKey, table.name),
}));

export const bibleSources = pgTable("bible_sources", {
  id: serial("id").primaryKey(),
  collectionId: integer("collection_id").references(() => bibleCollections.id, { onDelete: "cascade" }).notNull(),
  sourceType: text("source_type").notNull(),
  name: text("name").notNull(),
  version: text("version"),
  language: text("language"),
  license: text("license"),
  uri: text("uri"),
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (table) => ({
  collectionSourceUnique: uniqueIndex("bible_sources_collection_name_unique").on(table.collectionId, table.name),
}));

export const biblePassages = pgTable("bible_passages", {
  id: serial("id").primaryKey(),
  collectionId: integer("collection_id").references(() => bibleCollections.id, { onDelete: "cascade" }).notNull(),
  sourceId: integer("source_id").references(() => bibleSources.id, { onDelete: "set null" }),
  reference: text("reference").notNull(),
  book: text("book"),
  chapter: integer("chapter"),
  verseStart: integer("verse_start"),
  verseEnd: integer("verse_end"),
  text: text("text").notNull(),
  canonical: integer("canonical").notNull().default(1),
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (table) => ({
  collectionReferenceUnique: uniqueIndex("bible_passages_collection_reference_unique").on(table.collectionId, table.reference),
  collectionBookChapterIndex: index("bible_passages_collection_book_chapter_idx").on(table.collectionId, table.book, table.chapter),
}));

export const bibleResearch = pgTable("bible_research", {
  id: serial("id").primaryKey(),
  collectionId: integer("collection_id").references(() => bibleCollections.id, { onDelete: "cascade" }).notNull(),
  passageId: integer("passage_id").references(() => biblePassages.id, { onDelete: "cascade" }).notNull(),
  kind: text("kind").notNull(),
  title: text("title"),
  content: text("content").notNull(),
  source: text("source"),
  sourceUri: text("source_uri"),
  verification: text("verification").notNull().default("unverified"),
  confidence: real("confidence").default(0),
  aiGenerated: integer("ai_generated").notNull().default(0),
  provenance: jsonb("provenance").default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
}, (table) => ({
  passageKindIndex: index("bible_research_passage_kind_idx").on(table.passageId, table.kind),
  verificationIndex: index("bible_research_verification_idx").on(table.verification),
}));

export const biblePopcorns = pgTable("bible_popcorns", {
  id: serial("id").primaryKey(),
  collectionId: integer("collection_id").references(() => bibleCollections.id, { onDelete: "cascade" }).notNull(),
  passageId: integer("passage_id").references(() => biblePassages.id, { onDelete: "cascade" }).notNull(),
  excerpt: text("excerpt").notNull(),
  reason: text("reason").notNull(),
  characterPotential: text("character_potential"),
  visualPotential: text("visual_potential"),
  dialoguePotential: text("dialogue_potential"),
  conflictPotential: text("conflict_potential"),
  emotionalPotential: text("emotional_potential"),
  productionNotes: text("production_notes"),
  priority: integer("priority").notNull().default(50),
  confidence: real("confidence").default(0),
  verification: text("verification").notNull().default("pending"),
  provenance: jsonb("provenance").default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
}, (table) => ({
  passageExcerptUnique: uniqueIndex("bible_popcorns_passage_excerpt_unique").on(table.passageId, table.excerpt),
  priorityIndex: index("bible_popcorns_collection_priority_idx").on(table.collectionId, table.priority),
}));

export const bibleLinks = pgTable("bible_links", {
  id: serial("id").primaryKey(),
  collectionId: integer("collection_id").references(() => bibleCollections.id, { onDelete: "cascade" }).notNull(),
  fromPassageId: integer("from_passage_id").references(() => biblePassages.id, { onDelete: "cascade" }),
  toPassageId: integer("to_passage_id").references(() => biblePassages.id, { onDelete: "cascade" }),
  linkType: text("link_type").notNull(),
  label: text("label"),
  provenance: jsonb("provenance").default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (table) => ({
  linkIndex: index("bible_links_collection_type_idx").on(table.collectionId, table.linkType),
}));

export const bibleNotes = pgTable("bible_notes", {
  id: serial("id").primaryKey(),
  collectionId: integer("collection_id").references(() => bibleCollections.id, { onDelete: "cascade" }).notNull(),
  passageId: integer("passage_id").references(() => biblePassages.id, { onDelete: "cascade" }),
  popcornId: integer("popcorn_id").references(() => biblePopcorns.id, { onDelete: "cascade" }),
  note: text("note").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
}, (table) => ({
  passageIndex: index("bible_notes_passage_idx").on(table.passageId),
  popcornIndex: index("bible_notes_popcorn_idx").on(table.popcornId),
}));


export const scriptureEvidence = pgTable("scripture_evidence", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").references(() => projects.id, { onDelete: "cascade" }).notNull(),
  collectionId: integer("collection_id").references(() => bibleCollections.id, { onDelete: "cascade" }).notNull(),
  premise: text("premise").notNull(),
  selectedReferences: jsonb("selected_references").$type<string[]>().notNull().default([]),
  confidence: real("confidence").notNull().default(0),
  verification: text("verification").notNull().default("unverified"),
  provenance: jsonb("provenance").default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
}, (table) => ({
  projectIndex: index("scripture_evidence_project_idx").on(table.projectId),
  collectionIndex: index("scripture_evidence_collection_idx").on(table.collectionId),
}));

export const bibleEntities = pgTable("bible_entities", {
  id: serial("id").primaryKey(),
  collectionId: integer("collection_id").references(() => bibleCollections.id, { onDelete: "cascade" }).notNull(),
  kind: text("kind").notNull(),
  name: text("name").notNull(),
  aliases: jsonb("aliases").$type<string[]>().default([]),
  description: text("description"),
  provenance: jsonb("provenance").default({}),
  verification: text("verification").notNull().default("unverified"),
  confidence: real("confidence").default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
}, (table) => ({
  collectionKindNameUnique: uniqueIndex("bible_entities_collection_kind_name_unique").on(table.collectionId, table.kind, table.name),
}));

export const bibleEntityLinks = pgTable("bible_entity_links", {
  id: serial("id").primaryKey(),
  collectionId: integer("collection_id").references(() => bibleCollections.id, { onDelete: "cascade" }).notNull(),
  entityId: integer("entity_id").references(() => bibleEntities.id, { onDelete: "cascade" }).notNull(),
  passageId: integer("passage_id").references(() => biblePassages.id, { onDelete: "cascade" }).notNull(),
  relationship: text("relationship").notNull().default("mentioned"),
  provenance: jsonb("provenance").default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (table) => ({
  entityPassageUnique: uniqueIndex("bible_entity_passage_relationship_unique").on(table.entityId, table.passageId, table.relationship),
}));

export const bibleStudyLinks = pgTable("bible_study_links", {
  id: serial("id").primaryKey(),
  collectionId: integer("collection_id").references(() => bibleCollections.id, { onDelete: "cascade" }).notNull(),
  passageId: integer("passage_id").references(() => biblePassages.id, { onDelete: "cascade" }).notNull(),
  projectId: integer("project_id").references(() => projects.id, { onDelete: "cascade" }),
  sceneId: integer("scene_id").references(() => scenes.id, { onDelete: "cascade" }),
  popcornId: integer("popcorn_id").references(() => biblePopcorns.id, { onDelete: "cascade" }),
  linkType: text("link_type").notNull(),
  note: text("note"),
  provenance: jsonb("provenance").default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (table) => ({
  passageProjectSceneIndex: index("bible_study_links_passage_project_scene_idx").on(table.passageId, table.projectId, table.sceneId),
}));
