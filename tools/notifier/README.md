# Notifier (Telegram)

Watches the Firestore `bins` collection and sends a Telegram message when a bin turns `full`. It works no matter how the bin got into Firestore (the MQTT bridge, `seed.js`, or editing by hand in the Firebase console).

It alerts only on the change **to** `full`. Starting it while a bin is already full does not message, and repeated updates to a full bin do not message again.

## Set up (once)

1. In Telegram, message **@BotFather**, send `/newbot`, and follow the steps. Copy the token it gives you.
2. Open your new bot in Telegram and send it any message (or add the bot to a group the cleaners are in).
3. Open `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates` in a browser and find `"chat":{"id": 123456789`. That number is the chat id. A group id starts with `-`.
4. `cp .env.example .env` in this folder and fill in `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`.
5. The Firebase config is read from `app/.env`, so the website's `.env` must already be set up.

```bash
cd tools/notifier
npm install
npm run dry     # prints what it would send, no Telegram needed
npm start       # sends for real
```

Leave it running (a terminal on the demo laptop). Then set a bin to `full` in Firebase and the message arrives within a second or two.

## Notes

- The bot token is a secret. Keep it in `.env` only.
- It reads Firestore with the public web config, so the Firestore rules must allow reading `bins` (they do).
- It must keep running to send anything. For an always-on setup, host it on any small server.
