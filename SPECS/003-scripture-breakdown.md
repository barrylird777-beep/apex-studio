# SPEC-003: Scripture-to-Scene Breakdown

## Goal
Allow a user to enter a scripture passage and generate a production-ready scene breakdown.

## Requirements
- Input a scripture reference or passage text.
- Generate structured scenes with scripture reference, location, characters, action, emotional/spiritual beat, and production notes.
- User can edit generated fields.
- Save the breakdown to a selected project.
- Persist scenes through Drizzle and show them in the project scene list.

## Acceptance Criteria
- A scripture reference generates validated scenes.
- Required fields appear and validate.
- User edits can be made before saving.
- Scenes persist linked to the selected project.
- Clean starting state.

## Out of Scope
- Full AI scripture parsing
- Call sheets
- Calendar
- Budget
- Any other SPEC
