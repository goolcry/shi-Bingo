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

Configure the existing bot, webhook, Telegram Mini App, and TiDB environment variables in Vercel. Keep `.env` local and never commit it. The room/game tables are created by the existing database schema initializer.

## Rooms and game rules

When a player opens the lobby, the server automatically creates a persistent waiting room if no joinable room is available. A database row lock prevents simultaneous app opens from creating duplicate empty rooms. New rooms use a 2-player start threshold, a 20-player capacity, and cartelas cost 10.00 BIRR.

Each room has 100 generated cartelas; a player may hold up to three. Cartela purchases debit the same wallet as the bot, and returning/leaving a waiting room refunds those purchases. Cartelas cannot be changed or refunded after the game starts. Selected cartelas are green, other players' selections are red, and free cartelas are purple. The lobby checks for a joinable waiting room when opened and refreshes the listing every eight seconds.

The server calls a random, not-yet-called number as active players poll the game state. The interval defaults to five seconds and can be changed with `BINGO_CALL_INTERVAL_SECONDS` (1–3600). The game ends on the first verified horizontal/vertical line or four corners. Eighty percent of the room pool is split equally among winning cartelas; any indivisible remainder cent is assigned in cartela order. The remaining 20% is retained as the house fee. A game with all 75 numbers called and no winning cartela ends without a prize.

This implementation uses database-backed polling rather than WebSockets, so active Mini App clients must remain open for calls to advance.
