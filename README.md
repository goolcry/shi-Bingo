# SHISHO BINGO

Telegram bot and Mini App with a TiDB-backed wallet and Bingo rooms.

## Build and run

Use Node.js 20 or newer:

```powershell
npm install
npm run build
npm start
```

The build bundles `web/app.jsx` and its React dependencies into `public/mini-app.js`. Vercel runs this build command from `vercel.json`; keep the Vercel output directory unset so the Express app and its serverless routes remain active. Deploy again after changing the Mini App or backend.

Configure the existing bot, webhook, Telegram Mini App, TiDB, and `CRON_SECRET` environment variables in Vercel. Generate `CRON_SECRET` with `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"` and set the same value in local `.env` when running locally. Keep `.env` local and never commit it. The Hobby-compatible Vercel cron calls the protected `/api/cron/rooms` endpoint daily as a fallback. While a player is in a room, room-state polling and cartela actions process an expired countdown immediately; on Hobby, a room with no active clients may not be processed until the next daily cron. Upgrade to Vercel Pro and change the schedule in `vercel.json` to `* * * * *` if unattended countdown processing near the deadline is required. Open the Mini App using the SHISHO BINGO bot's native Play/menu button (or `/play`); a plain website URL has no signed Telegram launch data, so the server correctly withholds the user's wallet and does not allow joining. The wallet badge and bot balance command use the same available-balance calculation from the `wallets` table, including pending withdrawal reservations. The Mini App refreshes it on return to the foreground and every ten seconds while authenticated. The room/game tables are created by the existing database schema initializer.

## Rooms and game rules

When the lobby opens, the server automatically creates a persistent waiting room if no joinable room is available. The room list and room creation do not require identity data; joining, wallet access, and every game action still require verified Telegram Mini App authentication. This lets the lobby display its real room card even when the URL is opened outside Telegram, without allowing unauthenticated play. A database row lock prevents simultaneous app opens from creating duplicate empty rooms. New rooms use a 30-second persisted cartela-selection countdown, a minimum of three valid active cartela reservations, a 20-player capacity, and cartelas cost 10.00 BIRR. Existing waiting rooms are migrated to the same three-cartela rule and get persisted countdown timestamps.

Each room has 100 generated cartelas; a player may hold up to two. JOIN authenticates the player, checks room status and capacity under a database row lock, then returns the current room/cartela state and authoritative available wallet balance. It also repairs missing or malformed unreserved cartela layouts in older rooms; layouts with an owner or active reservation are preserved rather than overwritten. Tapping an available cartela immediately updates the tile, displayed balance, selected count, and net pot optimistically, then queues the authenticated `POST /api/rooms/:id/cartela` reservation/debit request; server errors restore the authoritative room and wallet state. Deselecting uses the same immediate feedback and atomically refunds the stake while the room is waiting. The selected cartelas' stable 5×5 previews appear below the grid. The UI polls authoritative room state every three seconds so cartela ownership, player and cartela counts, net prize pot (80% of gross stakes), countdown, and room status synchronize between participants. At deadline, the room starts only if at least three valid active cartela reservations exist. If fewer than three are ready, the room remains open and the server resets the countdown to 30 seconds. The room-start transition is idempotent and is processed by room polling and by the Vercel cron (daily fallback on Hobby, every minute on Pro). Returning to the lobby preserves room membership and reservations; explicitly leaving a waiting room refunds them. Cartelas cannot be changed or refunded after the game starts. Selected cartelas are green, other players' selections are red, and free cartelas are purple. The lobby refreshes the listing every eight seconds.

The server calls a random, not-yet-called number as active players poll the game state. The interval defaults to five seconds and can be changed with `BINGO_CALL_INTERVAL_SECONDS` (1–3600). The game ends on the first verified horizontal/vertical line or four corners. Eighty percent of the room pool is split equally among winning cartelas; any indivisible remainder cent is assigned in cartela order. The remaining 20% is retained as the house fee. A game with all 75 numbers called and no winning cartela ends without a prize.

This implementation uses database-backed polling rather than WebSockets, so active Mini App clients must remain open for calls to advance.
