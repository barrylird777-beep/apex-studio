# SPEC-002: Biblical Character Database

## Goal
Searchable, editable database of biblical characters with continuity across stories.

## Requirements
- Full CRUD for characters
- Fields: canonicalName, aliases[], primaryStories[], relationships[], keyTraits[], notes, scriptureReferences[]
- Search by name or story
- Ability to view character detail
- Seed the database with the 40+ characters from src/db/seed.ts
- Clean empty state

## Acceptance Criteria
- User can create, edit, and delete characters
- Search returns correct results
- Character detail page shows all fields
- Seed data loads successfully
- Data persists in SQLite via Drizzle

## Out of Scope
- Linking characters to scenes (that comes later)
- Any other SPEC