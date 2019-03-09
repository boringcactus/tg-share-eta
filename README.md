# tg-share-eta

a Telegram bot that lets you share your ETA to a given destination

## setup

1. create your Telegram bot by talking to [@BotFather](https://t.me/BotFather) on Telegram. hang onto your token. make sure you enable inline mode and inline feedback.
2. create your Google Maps API key [here](https://developers.google.com/maps/documentation/directions/start#get-a-key). you'll need to enter billing info, but it probably won't charge you.
   (as of march 2019, you can make 20,000 free requests a month, and since telegram's live location sharing updates roughly once every two minutes, you get almost 28 continuous days for a single user)
3. remix the [Glitch app](https://glitch.com/~tg-share-eta)
4. fill in the `.env` file.
   `BOT_TOKEN` should be your Telegram bot token, `GOOGLE_MAPS_API_KEY` should be your Google Maps API key, and `ALLOWED_USERS` should be a comma separated list of Telegram user IDs who are allowed to use the bot (can be empty at first).
5. if a user who isn't in the allowed users list (at first, this'll be you too) tries to use the bot, they'll get an error like "Your user id 123456789 is not in the list of allowed users. Forward this to the bot admin."
   add that user id to `ALLOWED_USERS` in your `.env` and restart the bot, and they'll be able to use it.
