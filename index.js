require('dotenv').config();
const { Client, GatewayIntentBits, Partials, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const Canvas = require('canvas');
const fetch = require('node-fetch');
const sharp = require('sharp');
const path = require('path');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions
    ],
    partials: [Partials.Channel, Partials.Message, Partials.Reaction]
});

// ----------------- Fonts -----------------
function registerFonts() {
    try {
        Canvas.registerFont(path.join(__dirname, 'fonts', 'NotoSans-Regular.ttf'), { family: 'NotoSans' });
        Canvas.registerFont(path.join(__dirname, 'fonts', 'NotoSansSymbols-Regular.ttf'), { family: 'NotoSymbols' });
        Canvas.registerFont(path.join(__dirname, 'fonts', 'NotoSansSymbols2-Regular.ttf'), { family: 'NotoSymbols2' });
        Canvas.registerFont(path.join(__dirname, 'fonts', 'NotoSansMath-Regular.ttf'), { family: 'NotoMath' });
        // For Windows emojis fallback
        Canvas.registerFont('C:\\Windows\\Fonts\\seguiemj.ttf', { family: 'SegoeEmoji' });
    } catch (err) {
        console.warn("Font load failed, fallback system fonts will be used:", err.message);
    }
}
registerFonts();

// ----------------- Helpers -----------------
const WILDCARD_TRIGGERS = ['quote', 'ass'];

function wrapText(ctx, text, maxWidth, maxFontSize) {
    let fontSize = maxFontSize;
    let lines = [];
    const paragraphs = text.split(/\r?\n/);

    while (fontSize > 10) {
        ctx.font = `${fontSize}px "NotoSans", "NotoSymbols", "NotoSymbols2", "SegoeEmoji", "NotoMath"`;
        lines = [];
        for (const para of paragraphs) {
            if (!para.trim()) { lines.push(''); continue; }
            const words = para.split(' ');
            let line = '';
            for (const word of words) {
                const test = line + word + ' ';
                if (ctx.measureText(test).width > maxWidth) {
                    if (line) lines.push(line.trim());
                    line = word + ' ';
                } else { line = test; }
            }
            if (line) lines.push(line.trim());
        }
        const totalHeight = lines.length * fontSize * 1.2;
        if (totalHeight <= 250) break;
        fontSize -= 2;
    }
    return { lines, fontSize };
}

function extractURLs(text) { return text.match(/https?:\/\/[^\s]+/gi) || []; }
function sanitizeLinks(text) { return text.replace(/https?:\/\/[^\s]+/gi, '🌐'); }
function getMessageText(msg) {
    if (msg.content?.trim()) return msg.content;
    if (msg.embeds.length > 0) {
        const e = msg.embeds[0];
        return e.title || e.description || '';
    }
    return '';
}
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

// ----------------- Generate Quote Image -----------------
async function generateQuoteImage(text, username, avatarURL, serverName, nickname, imageUrl) {
    const width = 1000;
    const height = 400;
    const canvas = Canvas.createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // Background
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);

    // Avatar
    const avatarBuffer = await (await fetch(avatarURL)).buffer();
    const avatarImg = await Canvas.loadImage(await sharp(avatarBuffer).png().toBuffer());
    ctx.drawImage(avatarImg, 0, 0, height, height);

    const padding = 40;
    const contentX = height + padding;
    const contentWidth = width - height - padding * 2;

    // Image overlay (no darkening)
    if (imageUrl) {
        try {
            const img = await Canvas.loadImage(imageUrl);
            const scale = Math.min(contentWidth / img.width, (height - padding * 2) / img.height);
            const w = img.width * scale;
            const h = img.height * scale;
            ctx.drawImage(img, contentX + (contentWidth - w) / 2, padding + (height - padding * 2 - h) / 2, w, h);
        } catch {}
    }

    // Text overlay
    text = text ? `"${sanitizeLinks(text)}"` : '';
    const { lines, fontSize } = wrapText(ctx, text, contentWidth, 60);

    const nonEmptyLines = lines.filter(l => l.trim() !== '');
    let yStart = padding + 40;

    if (nonEmptyLines.length === 1) {
        ctx.font = `${fontSize + 10}px "NotoSans", "NotoSymbols", "NotoSymbols2", "SegoeEmoji", "NotoMath"`;
        const textWidth = ctx.measureText(nonEmptyLines[0]).width;
        yStart = height / 2 - (fontSize + 10) / 2;
        ctx.fillStyle = '#fff';
        ctx.fillText(nonEmptyLines[0], contentX + (contentWidth - textWidth) / 2, yStart);
    } else {
        let y = yStart;
        ctx.fillStyle = '#fff';
        for (const line of lines) {
            ctx.font = `${fontSize}px "NotoSans", "NotoSymbols", "NotoSymbols2", "SegoeEmoji", "NotoMath"`;
            ctx.fillText(line, contentX, y);
            y += fontSize * 1.2;
        }
    }

    // Metadata
    ctx.font = `24px "NotoSans"`;
    ctx.fillStyle = '#d580ff';
    ctx.fillText(`- ${serverName}`, contentX, height - 70);
    ctx.fillStyle = '#fff';
    ctx.fillText(`${nickname} (@${username})`, contentX, height - 40);

    return canvas.toBuffer();
}

// ----------------- Auto Reactions -----------------
async function autoReact(message) {
    if (message.channel.name === 'news-spam') {
        await message.react('🔌'); // plug_alert
        await message.react('🟣'); // yappatron
    } else if (message.channel.name === 'twitch-youtube-plugs') {
        await message.react('🔌'); // plug_alert
    }
}

// ----------------- Message Handler -----------------
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    autoReact(message).catch(() => {});

    let targetMessage = null;
    const content = message.content.toLowerCase();

    if (message.reference && WILDCARD_TRIGGERS.some(t => content.includes(t))) {
        targetMessage = await message.channel.messages.fetch(message.reference.messageId);
    } else if (content.startsWith('quote') && message.mentions.users.size) {
        const user = message.mentions.users.first();
        targetMessage = await getTopReactionMessageGlobal(message.guild, user.id);
        if (!targetMessage) return message.reply('No messages found.');
    } else if (content.startsWith('quote')) {
        let cleaned = message.content.replace(/^quote\s*/i, '');
        if (!cleaned.trim()) cleaned = message.content;
        targetMessage = { ...message, content: cleaned };
    } else return;

    const text = getMessageText(targetMessage);
    const image = getImageFromMessage(targetMessage);
    const linkURLs = extractURLs(text);

    const buffer = await generateQuoteImage(
        text,
        targetMessage.author.username,
        targetMessage.author.displayAvatarURL({ format: 'png', size: 256 }),
        message.guild?.name || 'DM',
        message.guild?.members.cache.get(targetMessage.author.id)?.displayName || targetMessage.author.username,
        image
    );

    // Buttons for links
    let components = [];
    if (linkURLs.length > 0) {
        const row = new ActionRowBuilder();
        linkURLs.slice(0, 5).forEach(url => {
            row.addComponents(
                new ButtonBuilder()
                    .setLabel('🌐')
                    .setStyle(ButtonStyle.Link)
                    .setURL(url)
            );
        });
        components.push(row);
    }

    await message.channel.send({ files: [{ attachment: buffer, name: 'quote.png' }], components });

    try { await message.delete(); } catch {}
});

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

client.login(process.env.TOKEN);