// ONLY showing FULL FILE (clean final version)

require('dotenv').config();
const { Client, GatewayIntentBits, Partials } = require('discord.js');
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
        if (e.thumbnail?.url) return e.thumbnail.url;
    }

    return null;
}

// ------------------
async function generateQuoteImage(text, username, avatarURL, serverName, nickname, imageUrl) {
    const width = 1000;
    const height = 400;

    const canvas = Canvas.createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);

    // Avatar
    const avatar = await Canvas.loadImage(
        await sharp(await (await fetch(avatarURL)).buffer()).png().toBuffer()
    );
    ctx.drawImage(avatar, 0, 0, height, height);

    const padding = 30;
    const contentX = height + padding;
    const contentWidth = width - height - padding * 2;
    const contentHeight = height - padding * 2;

    // ------------------
    // IMAGE MODE
    // ------------------
    if (imageUrl) {
        try {
            const img = await Canvas.loadImage(imageUrl);

            // scale to fit without cropping
            const scale = Math.min(
                contentWidth / img.width,
                contentHeight / img.height
            );

            const drawWidth = img.width * scale;
            const drawHeight = img.height * scale;

            const x = contentX + (contentWidth - drawWidth) / 2;
            const y = padding + (contentHeight - drawHeight) / 2;

            ctx.drawImage(img, x, y, drawWidth, drawHeight);

            // slight overlay for text readability
            ctx.fillStyle = 'rgba(0,0,0,0.4)';
            ctx.fillRect(contentX, padding, contentWidth, contentHeight);

        } catch {}
    }

    // ------------------
    // TEXT
    // ------------------
    text = text ? `"${text}"` : "";

    const { lines, fontSize } = wrapTextGolden(
        ctx,
        text,
        contentWidth,
        contentHeight / GOLDEN_RATIO,
        60
    );

    let y = padding + (contentHeight - (lines.length * fontSize * 1.2) - 100) / 2;

    ctx.fillStyle = '#ffffff';

    lines.forEach(line => {
        ctx.font = `${fontSize}px "NotoSans", "NotoSymbols", "NotoSymbols2", "NotoEmoji", "NotoMath"`;

        const textWidth = ctx.measureText(line).width;
        ctx.fillText(line, contentX + (contentWidth - textWidth) / 2, y);

        y += fontSize * 1.2;
    });

    // Server glow
    const gradient = ctx.createLinearGradient(contentX, 0, contentX + 300, 0);
    gradient.addColorStop(0, '#d580ff');
    gradient.addColorStop(1, '#6a00ff');

    ctx.shadowColor = '#a855f7';
    ctx.shadowBlur = 40;
    ctx.fillStyle = gradient;
    ctx.font = `24px "NotoSans"`;
    ctx.fillText(`- ${serverName}`, contentX, height - 80);

    ctx.shadowBlur = 0;
    ctx.fillStyle = '#fff';
    ctx.fillText(`${nickname} (@${username})`, contentX, height - 50);

    return canvas.toBuffer();
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
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const content = message.content.toLowerCase();
    let targetMessage = null;

    if (message.reference && WILDCARD_TRIGGERS.some(t => content.includes(t))) {
        targetMessage = await message.channel.messages.fetch(message.reference.messageId);
    }
    else if (content.startsWith('quote') && message.mentions.users.size) {
        const user = message.mentions.users.first();
        targetMessage = await getTopReactionMessageGlobal(message.guild, user.id);
        if (!targetMessage) return message.reply("No messages found.");
    }
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
    const image = getImageFromMessage(targetMessage);

    const buffer = await generateQuoteImage(
        text,
        user.username,
        user.displayAvatarURL({ format: 'png', size: 256 }),
        message.guild?.name || 'DM',
        member?.displayName || user.username,
        image
    );

    await message.channel.send({
        files: [{ attachment: buffer, name: 'quote.png' }]
    });
});

client.login(process.env.TOKEN);