// (FULL FILE — updated layout + link buttons restored)

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
function wrapText(ctx, text, maxWidth, maxFontSize) {
    let fontSize = maxFontSize;
    let lines = [];

    while (fontSize > 10) {
        ctx.font = `${fontSize}px "NotoSans", "NotoSymbols", "NotoSymbols2", "NotoEmoji", "NotoMath"`;

        let words = text.split(' ');
        lines = [];
        let line = '';

        for (let word of words) {
            const test = line + word + ' ';
            if (ctx.measureText(test).width > maxWidth) {
                if (line) lines.push(line.trim());
                line = word + ' ';
            } else {
                line = test;
            }
        }

        if (line) lines.push(line.trim());

        if (lines.length * fontSize * 1.2 < 250) break;
        fontSize -= 2;
    }

    return { lines, fontSize };
}

// ------------------
// URL EXTRACT (RESTORED)
// ------------------
function extractURLs(text) {
    const urls = [];
    const raw = text.match(/https?:\/\/[^\s]+/gi) || [];
    urls.push(...raw);
    return urls;
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

    const padding = 40;
    const contentX = height + padding;
    const contentWidth = width - height - padding * 2;

    // IMAGE MODE
    if (imageUrl) {
        try {
            const img = await Canvas.loadImage(imageUrl);

            const scale = Math.min(
                contentWidth / img.width,
                (height - padding * 2) / img.height
            );

            const w = img.width * scale;
            const h = img.height * scale;

            ctx.drawImage(
                img,
                contentX + (contentWidth - w) / 2,
                padding + (height - padding * 2 - h) / 2,
                w,
                h
            );

            ctx.fillStyle = 'rgba(0,0,0,0.35)';
            ctx.fillRect(contentX, padding, contentWidth, height - padding * 2);

        } catch {}
    }

    // TEXT (LEFT ALIGNED + LOWERED)
    text = text ? `"${text}"` : "";

    const { lines, fontSize } = wrapText(ctx, text, contentWidth, 60);

    let y = padding + 40; // LOWERED

    ctx.fillStyle = '#fff';

    lines.forEach(line => {
        ctx.font = `${fontSize}px "NotoSans", "NotoSymbols", "NotoSymbols2", "NotoEmoji", "NotoMath"`;
        ctx.fillText(line, contentX, y);
        y += fontSize * 1.2;
    });

    // METADATA (LOWERED)
    const gradient = ctx.createLinearGradient(contentX, 0, contentX + 300, 0);
    gradient.addColorStop(0, '#d580ff');
    gradient.addColorStop(1, '#6a00ff');

    ctx.shadowColor = '#a855f7';
    ctx.shadowBlur = 40;
    ctx.fillStyle = gradient;
    ctx.font = `24px "NotoSans"`;
    ctx.fillText(`- ${serverName}`, contentX, height - 70);

    ctx.shadowBlur = 0;
    ctx.fillStyle = '#fff';
    ctx.fillText(`${nickname} (@${username})`, contentX, height - 40);

    return canvas.toBuffer();
}

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

    // 🔗 FIXED LINKS
    const linkURLs = extractURLs(targetMessage.content);

    const text = getMessageText(targetMessage)
        .replace(/https?:\/\/[^\s]+/gi, '🌐');

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

    // 🔗 BUTTONS RESTORED
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

    await message.channel.send({
        files: [{ attachment: buffer, name: 'quote.png' }],
        components
    });
});

client.login(process.env.TOKEN);