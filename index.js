const { Composer } = require('micro-bot');
const bot = new Composer();

const googleMapsClient = require('@google/maps').createClient({
    key: process.env.GOOGLE_MAPS_API_KEY,
    Promise: Promise,
});

// TODO maybe use an actual goddamn database
const states = {};

const UPDATE_INTERVAL_MINUTES = 1;

const ALLOWED_USERS = process.env.ALLOWED_USERS.split(',').map(x => parseInt(x, 10));

async function getArrivalInTimeZone(location, delay) {
  let nowTimestamp = Math.floor(Date.now() / 1000);
  let timestamp = Math.floor(Date.now() / 1000) + delay;
  let response = await googleMapsClient.timezone({
      location,
      timestamp,
  }).asPromise();
  response = response.json;
  let nowTime = nowTimestamp + response.rawOffset + response.dstOffset;
  let finalTime = timestamp + response.rawOffset + response.dstOffset;
  return {now: new Date(nowTime * 1000), then: new Date(finalTime * 1000)};
}

class State {
    constructor() {
        this.destination = null;
        this.currentLocation = null;
        this.textInfo = {
            latest: null,
            older: null,
            lastUpdated: null,
        };
        this.chatID = null;
        this.messageID = null;
        this.inlineIDs = [];
    }

    get text() {
        const updateAndFetch = async () => {
            const now = Date.now();
            const then = this.textInfo.lastUpdated;
            if (then === null || now - then > UPDATE_INTERVAL_MINUTES * 60 * 1000) {
                if (this.destination === null) {
                    return 'Destination not set!';
                }
                if (this.currentLocation === null) {
                    return 'Current location unavailable!';
                }
                let response = await googleMapsClient.directions({
                    origin: this.currentLocation,
                    destination: this.destination,
                    mode: 'driving',
                    departure_time: 'now',
                    traffic_model: 'best_guess',
                }).asPromise();
                this.textInfo.older = this.textInfo.latest;
                response = response.json;
                if (response.status === 'OK') {
                    let {value, text: durationText} = response.routes[0].legs[0].duration_in_traffic;
                    let {now, then} = await getArrivalInTimeZone(this.destination, value);
                    let arrivalStr = then.toLocaleString('en-US', {hour: "numeric", minute: "2-digit"});
                    let updateStr = now.toLocaleString('en-US', {hour: "numeric", minute: "2-digit"});
                    if (value < 5) {
                        durationText = 'now';
                    }
                    this.textInfo.latest = 'ETA ' + durationText + " (" + arrivalStr + ")\n\n_last updated " + updateStr + '_';
                } else {
                    this.textInfo.latest = 'Error: ' + response.status;
                    if (response.error_message !== undefined && response.error_message.trim().length > 0) {
                        this.textInfo.latest += '\n' + response.error_message;
                    }
                }
                this.textInfo.lastUpdated = Date.now();
            }
            return this.textInfo.latest;
        };
        return updateAndFetch();
    }

    get ready() {
        return this.destination !== null && this.currentLocation !== null;
    }

    static async editMessage(telegram, chatID, messageID, inlineMessageID, text) {
        try {
            return await telegram.editMessageText(chatID, messageID, inlineMessageID, text, {parse_mode: 'Markdown'});
        } catch (err) {
            if (err.description !== 'Bad Request: message is not modified') {
                throw err;
            }
        }
    }

    async updateIfNeeded(telegram) {
        const promises = [];
        if (this.chatID !== null && this.messageID !== null) {
            const text = await this.text;
            if (this.textInfo.older !== this.textInfo.latest) {
                promises.push(State.editMessage(telegram, this.chatID, this.messageID, undefined, text));
            }
        }
        for (const message of this.inlineIDs) {
            const text = await this.text;
            if (this.textInfo.older !== this.textInfo.latest) {
                promises.push(State.editMessage(telegram, undefined, undefined, message, text));
            }
        }
        await Promise.all(promises);
    }

    async sendIfNeeded(ctx) {
        if (this.chatID === null && this.messageID === null) {
            const text = await this.text;
            const message = await ctx.reply(text, {
                reply_markup: {
                    inline_keyboard: [[{
                        text: 'Share',
                        switch_inline_query: '',
                    }]]
                },
                parse_mode: 'Markdown',
            });
            this.chatID = message.chat.id;
            this.messageID = message.message_id;
        }
    }
}

async function updateETA(ctx) {
    const message = ctx.message || ctx.editedMessage;
    const location = message.location;
    const state = ctx.state.obj;
    state.currentLocation = location;
    await Promise.all([state.updateIfNeeded(ctx.telegram), state.sendIfNeeded(ctx)]);
}

bot.use((ctx, next) => {
    if (ctx.from !== undefined || ctx.from.id !== undefined) {
        const userID = ctx.from.id;
        if (ALLOWED_USERS.includes(userID)) {
            if (states[userID] === undefined) {
                states[userID] = new State();
            }
            ctx.state.obj = states[userID];
        } else {
            if (ctx.updateType === 'message') {
                return ctx.replyWithMarkdown('Your user id ' + userID + ' is not in the list of allowed users. Forward this to the bot admin, or [make your own](https://github.com/boringcactus/tg-share-eta#tg-share-eta).');
            } else if (ctx.updateType === 'inline_query') {
                // pass along the query
                return next(ctx);
            } else {
                return Promise.resolve(undefined);
            }
        }
    }
    return next(ctx);
});

bot.start((ctx) => {
    states[ctx.from.id] = new State();
    return ctx.replyWithMarkdown(`Send your destination location, then start sharing your live location!`);
});

bot.on('location', (ctx) => {
    if (ctx.state.obj.destination === null) {
        ctx.state.obj.destination = ctx.message.location;
        return ctx.reply('Destination set! Start sharing live location to get an ETA.');
    } else {
        return updateETA(ctx);
    }
});

bot.on('edited_message', (ctx) => {
    return updateETA(ctx);
});

bot.on('inline_query', async (ctx) => {
    if (ctx.state.obj && ctx.state.obj.ready) {
        const text = await ctx.state.obj.text;
        const earlyText = text.split('_')[0];
        const result = [
            {
                type: "article",
                id: "a",
                title: earlyText,
                input_message_content: {
                    message_text: text,
                    parse_mode: 'Markdown',
                },
                reply_markup: {
                    inline_keyboard: [[{
                        text: 'this button should vanish soon',
                        callback_data: 'hi',
                    }]]
                },
            }
        ];
        await ctx.answerInlineQuery(result, {is_personal: true, cache_time: 0});
    } else {
        await ctx.answerInlineQuery([], {is_personal: true, cache_time: 0, switch_pm_text: 'Set up a route', switch_pm_parameter: 'inline'});
    }
});

bot.on('chosen_inline_result', async (ctx) => {
    let messageID = ctx.chosenInlineResult.inline_message_id;
    if (messageID !== undefined) {
        const state = ctx.state.obj;
        state.inlineIDs.push(messageID);
        await state.updateIfNeeded(ctx.telegram);
    }
});

bot.on('callback_query', (ctx) => ctx.answerCbQuery());

module.exports = {
    bot: bot,
    options: {
        telegram: {
            webhookReply: false,
        }
    },
    server: (req, res) => {
        if (req.url === '/') {
            res.end(`
                <html lang="en">
                <head>
                <title>ETA Sharing Bot</title>
                </head>
                <body>
                telegram bot that shares your ETA based on your live location. not publicly usable, but you can <a href="https://github.com/boringcactus/tg-share-eta#tg-share-eta">make your own</a>
                </body>
                </html>
            `);
        }
    }
};
