Original prompt: Build and iterate a playable web game in this workspace, validating changes with a Playwright loop. [$develop-web-game]

Notes:
- Initialized develop-web-game workflow.
- Created public/dragon-duel/ directory for game assets.

TODO:
- Implement standalone game page (public/game.html) and game logic.
- Add render_game_to_text + advanceTime hooks.
- Run Playwright loop and validate visuals/state.

Update:
- Added public/game.html and public/dragon-duel/game.js with initial Crystal Cavern Duel gameplay, UI, render_game_to_text, and advanceTime.

TODO:
- Start dev server and run Playwright loop against /game.html.
- Inspect screenshots/text output and fix any visual/state issues.
- Verify controls (move, jump, slash, dash, pause, fullscreen) and win/lose flows.

Update:
- Mapped actions to Playwright-supported keys (slash: B, dash: ArrowDown) while keeping J/K for manual play.
