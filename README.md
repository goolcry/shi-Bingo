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

The configured Telegram administrator creates rooms from **Profile → Create game room**. Every room requires an explicit minimum player threshold and maximum player limit. Each new cartela costs 10.00 BIRR. There is no assumed player threshold. A room starts automatically when that many distinct players have each purchased at least one cartela.

Each room has 100 generated cartelas; a player may hold up to two. Cartela purchases debit the same wallet as the bot, and returning/leaving a waiting room refunds those purchases. Cartelas cannot be changed or refunded after the game starts. Selected cartelas are green, other players' selections are red, and free cartelas are purple.

The server calls a random, not-yet-called number as active players poll the game state. The interval defaults to five seconds and can be changed with `BINGO_CALL_INTERVAL_SECONDS` (1–3600). The game ends on the first verified horizontal/vertical line or four corners. Eighty percent of the room pool is split equally among winning cartelas; any indivisible remainder cent is assigned in cartela order. The remaining 20% is retained as the house fee. A game with all 75 numbers called and no winning cartela ends without a prize.

This implementation uses database-backed polling rather than WebSockets, so active Mini App clients must remain open for calls to advance.
