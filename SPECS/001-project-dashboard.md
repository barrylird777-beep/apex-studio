# SPEC-001: Project Dashboard

## Goal
Main landing page showing all Bible-story projects.

## Requirements
- List projects with title, primary scripture, and status
- Ability to create a new project
- Ability to edit an existing project
- Ability to delete a project
- Clicking a project shows a simple overview containing:
  - Number of scenes
  - Number of linked characters (or 0 if none)
  - Next shoot day (if any exist)
- Data must persist via the Drizzle SQLite database
- Clean, helpful empty state when no projects exist

## Acceptance Criteria
- User can create, edit, and delete projects
- List updates immediately after changes
- Project overview shows correct counts
- Empty state is clear and actionable
- No other features are implemented

## Out of Scope
- Scene management
- Character management
- Call sheets
- Budget
- Any other SPEC