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

const GOLDEN_RATIO = 1.618;
const WILDCARD_TRIGGERS = ['quote', 'ass'];

// ------------------
// TEXT WRAP
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
// GLOBAL SEARCH
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

        } catch {}
    }

    return top;
}

// ------------------
// EXTRACT TEXT
// ------------------
function getMessageText(msg) {
    if (msg.content?.trim()) return msg.content;

    if (msg.embeds.length > 0) {
        const e = msg.embeds[0];
        return e.title || e.description || "Embedded message";
    }

    return "No text content";
}

// ------------------
// IMAGE DETECTION
// ------------------
function getImageFromMessage(msg) {
    if (msg.attachments.size > 0) {
        const att = msg.attachments.first();
        if (att.contentType?.startsWith('image')) return att.url;
    }

    if (msg.embeds.length > 0) {
        const e = msg.embeds[0];
        if (e.image?.url) return e.image.url;
        if (e.thumbnail?.url) return e.thumbnail.url;
    }

    return null;
}

// ------------------
// BRIGHTNESS DETECTION
// ------------------
async function getAverageBrightness(imageBuffer) {
    const { data } = await sharp(imageBuffer)
        .resize(10, 10)
        .raw()
        .toBuffer({ resolveWithObject: true });

    let total = 0;

    for (let i = 0; i < data.length; i += 3) {
        total += (data[i] + data[i + 1] + data[i + 2]) / 3;
    }

    return total / (data.length / 3);
}

// ------------------
// GENERATE IMAGE
// ------------------
async function generateQuoteImage(text, username, avatarURL, serverName, nickname, bgImageUrl) {
    const width = 1000;
    const height = 400;

    const canvas = Canvas.createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    let textColor = '#ffffff';

    // ------------------
    // BACKGROUND
    // ------------------
    if (bgImageUrl) {
        try {
            const res = await fetch(bgImageUrl);
            const buffer = await res.buffer();

            const bg = await Canvas.loadImage(buffer);

            // Blur effect
            ctx.filter = 'blur(12px)';
            ctx.drawImage(bg, 0, 0, width, height);
            ctx.filter = 'none';

            // Brightness detect
            const brightness = await getAverageBrightness(buffer);
            if (brightness > 140) textColor = '#000000';

            // Gradient overlay
            const gradient = ctx.createLinearGradient(0, 0, width, height);
            gradient.addColorStop(0, 'rgba(106,0,255,0.6)');
            gradient.addColorStop(1, 'rgba(213,128,255,0.6)');

            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, width, height);

        } catch {
            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, width, height);
        }
    } else {
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, width, height);
    }

    // Avatar
    const avatar = await Canvas.loadImage(
        await sharp(await (await fetch(avatarURL)).buffer()).png().toBuffer()
    );

    ctx.drawImage(avatar, 0, 0, height, height);

    const padding = 30;
    const blackX = height + padding;
    const blackWidth = width - height - padding * 2;
    const blackHeight = height - padding * 2;

    text = `"${text}"`;

    const { lines, fontSize } = wrapTextGolden(ctx, text, blackWidth, blackHeight / GOLDEN_RATIO, 60);

    const totalTextHeight = lines.length * fontSize * 1.2;
    let y = padding + (blackHeight - totalTextHeight - 100) / 2;

    ctx.fillStyle = textColor;

    lines.forEach(line => {
        ctx.font = `${fontSize}px "NotoSans", "NotoSymbols", "NotoSymbols2", "NotoEmoji", "NotoMath"`;

        const textWidth = ctx.measureText(line).width;
        ctx.fillText(line, blackX + (blackWidth - textWidth) / 2, y);

        y += fontSize * 1.2;
    });

    // Gradient glow server name
    const gradient = ctx.createLinearGradient(blackX, 0, blackX + 300, 0);
    gradient.addColorStop(0, '#d580ff');
    gradient.addColorStop(1, '#6a00ff');

    ctx.shadowColor = '#a855f7';
    ctx.shadowBlur = 40;
    ctx.fillStyle = gradient;
    ctx.font = `24px "NotoSans"`;
    ctx.fillText(`- ${serverName}`, blackX, height - 80);

    ctx.shadowBlur = 0;
    ctx.fillStyle = textColor;
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

    // Reply
    if (message.reference && WILDCARD_TRIGGERS.some(t => content.includes(t))) {
        targetMessage = await message.channel.messages.fetch(message.reference.messageId);
    }

    // Mention global
    else if (content.startsWith('quote') && message.mentions.users.size) {
        const user = message.mentions.users.first();
        targetMessage = await getTopReactionMessageGlobal(message.guild, user.id);

        if (!targetMessage) return message.reply("No messages found.");
    }

    // Self
    else if (content.startsWith('quote')) {
        let cleaned = message.content.replace(/^quote\s*/i, '');
        if (!cleaned.trim()) cleaned = message.content;

        targetMessage = { ...message, content: cleaned };
    }

    else return;

    const text = getMessageText(targetMessage)
        .replace(/https?:\/\/[^\s\)]+/gi, '🌐');

    const user = targetMessage.author;
    const member = message.guild?.members.cache.get(user.id);
    const bg = getImageFromMessage(targetMessage);

    const buffer = await generateQuoteImage(
        text,
        user.username,
        user.displayAvatarURL({ format: 'png', size: 256 }),
        message.guild?.name || 'DM',
        member?.displayName || user.username,
        bg
    );

    await message.channel.send({
        files: [{ attachment: buffer, name: 'quote.png' }]
    });
});

client.login(process.env.TOKEN);