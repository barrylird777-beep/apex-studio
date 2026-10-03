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

Read AGENTS.md and SPECS/002-characters.md completely before writing any code.
Follow the locked tech stack and domain rules strictly.

Current task: SPEC-002 – Biblical Character Database

Implement:
1. Full CRUD for characters using the existing Drizzle schema
2. Character list page with search
3. Character detail / edit view
4. Run the seed so the 40+ characters appear
5. Clean empty state

Do NOT implement any other SPEC.
Do NOT add scene linking, call sheets, or budget features.
After finishing, list every file you created or modified and give exact steps to test SPEC-002.

Drop SPECS/002-characters.md into the repo, then run the prompt above.