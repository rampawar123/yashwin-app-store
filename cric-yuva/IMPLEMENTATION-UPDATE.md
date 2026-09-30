# CRIC YUVA — Team/Roster/Playing XI Update

## Main changes
- Team roster endpoint now accepts a player by name/profile without requiring a Player ID from the UI.
- The backend still keeps a hidden permanent `player_id` as the database relationship key.
- Adding a player saves locally first and then syncs the player + team membership to the cloud when authenticated/online.
- New teams are saved as separate team records instead of overwriting the previous team in the cloud.
- Saved teams are loaded into Start Match Team A / Team B selectors using their real team IDs.
- Playing XI loads from the selected team's saved roster; cloud roster is used when online and local cache is used offline.
- Both Team A and Team B team IDs are stored in the active match.
- Existing scoring, tournament, match history, stats, notifications, PWA and database files were preserved.

## Verification
- `node --check` passed for all JavaScript files.
- `npm run verify` passed: 62 static/configured DB tests, 0 failures.

## Push
Copy the contents of this `cric-yuva` folder into your GitHub repository's `cric-yuva` folder and commit/push.
