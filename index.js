require('dotenv').config();
const { Client, GatewayIntentBits, Partials, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const Canvas = require('canvas');
const fetch = require('node-fetch');
const sharp = require('sharp');
const { registerFont } = require('canvas');
const path = require('path');

// Fonts
registerFont(path.join(__dirname, 'fonts', 'NotoSans-Regular.ttf'), { family: 'NotoSans' });
registerFont(path.join(__dirname, 'fonts', 'NotoColorEmoji.ttf'), { family: 'NotoEmoji' });
registerFont(path.join(__dirname, 'fonts', 'NotoSansSymbols-Regular.ttf'), { family: 'NotoSymbols' });
registerFont(path.join(__dirname, 'fonts', 'NotoSansSymbols2-Regular.ttf'), { family: 'NotoSymbols2' });
registerFont(path.join(__dirname, 'fonts', 'NotoSansMath-Regular.ttf'), { family: 'NotoMath' });

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions
    ],
    partials: [Partials.Channel, Partials.Message, Partials.Reaction]
});

client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}`);
});

const WILDCARD_TRIGGERS = ['quote','ass'];

// CHANNEL CONFIG
const NEWS_CHANNEL = "news-spam";
const PLUG_CHANNEL = "twitch-youtube-plugs";

// ------------------
function wrapText(ctx, text, maxWidth, maxFontSize) {
    let fontSize = maxFontSize;
    let lines = [];
    const paragraphs = text.split(/\r?\n/);

    while (fontSize > 10) {
        ctx.font = `${fontSize}px "NotoSans", "NotoSymbols", "NotoSymbols2", "NotoEmoji", "NotoMath"`;
        lines = [];

        for (const para of paragraphs) {
            if (!para.trim()) {
                lines.push('');
                continue;
            }
            const words = para.split(' ');
            let line = '';
            for (const word of words) {
                const test = line + word + ' ';
                if (ctx.measureText(test).width > maxWidth) {
                    if (line) lines.push(line.trim());
                    line = word + ' ';
                } else {
                    line = test;
                }
            }
            if (line) lines.push(line.trim());
        }

        const totalHeight = lines.length * fontSize * 1.2;
        if (totalHeight <= 250) break;
        fontSize -= 2;
    }

    return { lines, fontSize };
}

// ------------------
function extractURLs(text) {
    return text.match(/https?:\/\/[^\s]+/gi) || [];
}

// ------------------
function getMessageText(msg) {
    if (msg.content?.trim()) return msg.content;
    if (msg.embeds.length > 0) {
        const e = msg.embeds[0];
        return e.title || e.description || "";
    }
    return "";
}

// ------------------
function getImageFromMessage(msg) {
    if (msg.attachments.size > 0) {
        const att = msg.attachments.first();
        if (att.contentType?.startsWith('image')) return att.url;
    }
    if (msg.embeds.length > 0) {
        const e = msg.embeds[0];
        if (e.image?.url) return e.image.url;
    }
    return null;
}

// ------------------
function extractFakeQuote(content) {
    const match = content.match(/"([^"]+)"/);
    return match ? match[1] : null;
}

// ------------------
async function generateQuoteImage(text, username, avatarURL, serverName, nickname, imageUrl) {
    const width = 1000;
    const height = 400;

    const canvas = Canvas.createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);

    const avatar = await Canvas.loadImage(
        await sharp(await (await fetch(avatarURL)).buffer()).png().toBuffer()
    );
    ctx.drawImage(avatar, 0, 0, height, height);

    const padding = 40;
    const contentX = height + padding;
    const contentWidth = width - height - padding * 2;

    if (imageUrl) {
        try {
            const img = await Canvas.loadImage(imageUrl);
            ctx.drawImage(img, contentX, padding, contentWidth, height - padding * 2);
            ctx.fillStyle = 'rgba(0,0,0,0.5)';
            ctx.fillRect(contentX, padding, contentWidth, height - padding * 2);
        } catch {}
    }

    text = text ? `"${text}"` : "";
    const { lines, fontSize } = wrapText(ctx, text, contentWidth, 60);

    let y = padding + 40;
    ctx.fillStyle = '#fff';

    for (const line of lines) {
        ctx.font = `${fontSize}px "NotoSans", "NotoSymbols", "NotoSymbols2", "NotoEmoji", "NotoMath"`;
        ctx.fillText(line, contentX, y);
        y += fontSize * 1.2;
    }

    ctx.fillStyle = '#aaa';
    ctx.font = `22px "NotoSans"`;
    ctx.fillText(`- ${nickname} (@${username})`, contentX, height - 40);

    return canvas.toBuffer();
}

// ------------------
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    // AUTO REACTIONS
    try {
        if (message.channel.name === NEWS_CHANNEL) {
            await message.react('plug_alert');
            await message.react('yappatron');
        }
        if (message.channel.name === PLUG_CHANNEL) {
            await message.react('plug_alert');
        }
    } catch {}

    const content = message.content;

    if (!content.toLowerCase().startsWith('quote')) return;

    const fakeQuote = extractFakeQuote(content);
    let targetUser = null;
    let text = null;
    let image = null;

    // FAKE QUOTE MODE
    if (fakeQuote) {
        if (message.mentions.users.size) {
            targetUser = message.mentions.users.first();
        } else if (message.reference) {
            const replied = await message.channel.messages.fetch(message.reference.messageId);
            targetUser = replied.author;
        }

        if (!targetUser) return message.reply("You must tag or reply to fake quote.");

        text = fakeQuote;
    }

    // NORMAL QUOTE
    else if (message.reference) {
        const msg = await message.channel.messages.fetch(message.reference.messageId);
        targetUser = msg.author;
        text = getMessageText(msg);
        image = getImageFromMessage(msg);
    }

    else if (message.mentions.users.size) {
        return message.reply("Use quotes \"like this\" to fake quote a user.");
    }

    else {
        text = content.replace(/^quote\s*/i, '');
        targetUser = message.author;
    }

    const member = message.guild?.members.cache.get(targetUser.id);

    const buffer = await generateQuoteImage(
        text,
        targetUser.username,
        targetUser.displayAvatarURL({ format: 'png', size: 256 }),
        message.guild?.name || '',
        member?.displayName || targetUser.username,
        image
    );

    await message.channel.send({
        files: [{ attachment: buffer, name: 'quote.png' }]
    });

    try { await message.delete(); } catch {}
});

client.login(process.env.TOKEN);