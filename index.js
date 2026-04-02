require('dotenv').config();
const { Client, GatewayIntentBits, Partials, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const Canvas = require('canvas');
const fetch = require('node-fetch');
const sharp = require('sharp');
const { registerFont } = require('canvas');
const path = require('path');

// ------------------
// Fonts
// ------------------
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

const GOLDEN_RATIO = 1.618;
const WILDCARD_TRIGGERS = ['quote', 'ass'];

// ------------------
// WRAP TEXT
// ------------------
function wrapTextGolden(ctx, text, maxWidth, maxHeight, maxFontSize) {
    let fontSize = maxFontSize;
    let lines = [];

    while (fontSize > 10) {
        ctx.font = `${fontSize}px "NotoSans", "NotoSymbols", "NotoSymbols2", "NotoEmoji", "NotoMath"`;

        let words = text.split(' ').flatMap(word => {
            if (ctx.measureText(word).width > maxWidth) {
                return word.match(/.{1,12}/g) || [word];
            }
            return [word];
        });

        lines = [];
        let line = '';

        for (let word of words) {
            const testLine = line + word + ' ';
            if (ctx.measureText(testLine).width > maxWidth) {
                if (line) lines.push(line.trim());
                line = word + ' ';
            } else {
                line = testLine;
            }
        }

        if (line) lines.push(line.trim());

        const totalHeight = lines.length * (fontSize * 1.2);
        if (totalHeight <= maxHeight) break;

        fontSize -= 2;
    }

    return { lines, fontSize };
}

// ------------------
// 🔥 GLOBAL SEARCH (ALL CHANNELS)
// ------------------
async function getTopReactionMessageGlobal(guild, userId) {
    let top = null;
    let maxReacts = 0;

    const channels = await guild.channels.fetch();

    for (const [, channel] of channels) {
        if (!channel.isTextBased()) continue;

        try {
            const messages = await channel.messages.fetch({ limit: 50 });

            messages.forEach(msg => {
                if (msg.author.id === userId && msg.reactions.cache.size) {
                    let count = 0;
                    msg.reactions.cache.forEach(r => count += r.count);

                    if (count > maxReacts) {
                        maxReacts = count;
                        top = msg;
                    }
                }
            });

        } catch {
            continue; // skip inaccessible channels
        }
    }

    return top;
}

// ------------------
// Extract URLs
// ------------------
function extractURLs(text) {
    const urls = [];
    const raw = text.match(/https?:\/\/[^\s\)]+/gi) || [];
    urls.push(...raw);

    const md = [...text.matchAll(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/gi)];
    md.forEach(m => urls.push(m[2]));

    return urls;
}

// ------------------
// 🧠 Extract TEXT (supports embeds)
// ------------------
function getMessageText(msg) {
    if (msg.content && msg.content.trim().length > 0) return msg.content;

    if (msg.embeds.length > 0) {
        const e = msg.embeds[0];
        return e.title || e.description || "Embedded message";
    }

    return "No text content";
}

// ------------------
// IMAGE GENERATION
// ------------------
async function generateQuoteImage(text, username, avatarURL, serverName, nickname) {
    const width = 1000;
    const height = 400;
    const canvas = Canvas.createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);

    const response = await fetch(avatarURL);
    const avatarBuffer = await response.buffer();
    const avatar = await Canvas.loadImage(await sharp(avatarBuffer).png().toBuffer());

    ctx.drawImage(avatar, 0, 0, height, height);

    const padding = 30;
    const blackX = height + padding;
    const blackWidth = width - height - padding * 2;
    const blackHeight = height - padding * 2;

    text = `"${text}"`;

    const { lines, fontSize } = wrapTextGolden(ctx, text, blackWidth, blackHeight / GOLDEN_RATIO, 60);

    let y = padding + 20;

    ctx.fillStyle = '#fff';

    lines.forEach(line => {
        ctx.font = `${fontSize}px "NotoSans", "NotoSymbols", "NotoSymbols2", "NotoEmoji", "NotoMath"`;
        ctx.fillText(line, blackX, y);
        y += fontSize * 1.2;
    });

    // 🌈 Gradient glow
    const gradient = ctx.createLinearGradient(blackX, 0, blackX + 300, 0);
    gradient.addColorStop(0, '#d580ff');
    gradient.addColorStop(1, '#6a00ff');

    ctx.shadowColor = '#a855f7';
    ctx.shadowBlur = 40;
    ctx.fillStyle = gradient;

    ctx.font = `24px "NotoSans"`;
    ctx.fillText(`- ${serverName}`, blackX, height - 80);

    ctx.shadowBlur = 0;
    ctx.fillStyle = '#fff';
    ctx.fillText(`${nickname} (@${username})`, blackX, height - 50);

    return canvas.toBuffer();
}

// ------------------
// MESSAGE HANDLER
// ------------------
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const content = message.content.toLowerCase();
    let targetMessage = null;

    // Reply trigger
    if (message.reference && WILDCARD_TRIGGERS.some(t => content.includes(t))) {
        targetMessage = await message.channel.messages.fetch(message.reference.messageId);
    }

    // Mention trigger (GLOBAL SEARCH)
    else if (content.startsWith('quote') && message.mentions.users.size) {
        const user = message.mentions.users.first();
        targetMessage = await getTopReactionMessageGlobal(message.guild, user.id);

        if (!targetMessage) {
            return message.reply("No messages found across server.");
        }
    }

    // Self quote (FILTERED)
    else if (content.startsWith('quote')) {
        let cleaned = message.content.replace(/^quote\s*/i, '');
        if (!cleaned.trim()) cleaned = message.content;

        targetMessage = {
            ...message,
            content: cleaned
        };
    }

    else return;

    let text = getMessageText(targetMessage)
        .replace(/https?:\/\/[^\s\)]+/gi, '🌐');

    const user = targetMessage.author;
    const member = message.guild?.members.cache.get(user.id);

    const buffer = await generateQuoteImage(
        text,
        user.username,
        user.displayAvatarURL({ format: 'png', size: 256 }),
        message.guild?.name || 'DM',
        member?.displayName || user.username
    );

    await message.channel.send({
        files: [{ attachment: buffer, name: 'quote.png' }]
    });
});

client.login(process.env.TOKEN);