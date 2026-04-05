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

const WILDCARD_TRIGGERS = ['quote'];

// Channels for auto reactions
const NEWS_CHANNEL = "news-spam";
const PLUG_CHANNEL = "twitch-youtube-plugs";

// -------------------
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

function extractURLs(text) {
    return text.match(/https?:\/\/[^\s]+/gi) || [];
}

function getMessageText(msg) {
    if (msg.content?.trim()) return msg.content;
    if (msg.embeds.length > 0) {
        const e = msg.embeds[0];
        return e.title || e.description || "";
    }
    return "";
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

function extractFakeQuote(content) {
    const match = content.match(/"([^"]+)"/);
    return match ? match[1] : null;
}

// -------------------
async function generateQuoteImage(text, username, avatarURL, serverName, nickname, imageUrl) {
    const width = 1000;
    const height = 400;
    const canvas = Canvas.createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // Background
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

    // Optional overlay image
    if (imageUrl) {
        try {
            const img = await Canvas.loadImage(imageUrl);
            const scale = Math.min(contentWidth / img.width, (height - padding * 2) / img.height);
            const w = img.width * scale;
            const h = img.height * scale;
            ctx.drawImage(img, contentX + (contentWidth - w) / 2, padding + (height - padding * 2 - h) / 2, w, h);

            ctx.fillStyle = 'rgba(0,0,0,0.35)';
            ctx.fillRect(contentX, padding, contentWidth, height - padding * 2);
        } catch {}
    }

    // Add quotation marks
    text = `"${text}"`;

    // Text scaling and wrapping
    const { lines, fontSize } = wrapText(ctx, text, contentWidth, 60);
    const nonEmptyLines = lines.filter(l => l.trim() !== '');
    let yStart = padding + 40;

    if (nonEmptyLines.length === 1) {
        const singleLine = nonEmptyLines[0];
        ctx.font = `${fontSize + 10}px "NotoSans", "NotoSymbols", "NotoSymbols2", "NotoEmoji", "NotoMath"`;
        const textWidth = ctx.measureText(singleLine).width;
        yStart = height / 2 - (fontSize + 10) / 2;
        ctx.fillStyle = '#fff';
        ctx.fillText(singleLine, contentX + (contentWidth - textWidth) / 2, yStart);
    } else {
        let y = yStart;
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'left';
        for (const line of lines) {
            ctx.font = `${fontSize}px "NotoSans", "NotoSymbols", "NotoSymbols2", "NotoEmoji", "NotoMath"`;
            ctx.fillText(line, contentX, y);
            y += fontSize * 1.2;
        }
    }

    // Metadata gradient
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

// -------------------
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

// -------------------
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    // Auto reactions
    try {
        if (message.channel.name === NEWS_CHANNEL) {
            await message.react('plug_alert');
            await message.react('yappatron');
        } else if (message.channel.name === PLUG_CHANNEL) {
            await message.react('plug_alert');
        }
    } catch {}

    const content = message.content;

    if (!content.toLowerCase().startsWith('quote')) return;

    let fakeQuote = extractFakeQuote(content);
    let targetUser = null;
    let text = null;
    let image = null;

    if (fakeQuote) {
        if (message.mentions.users.size) targetUser = message.mentions.users.first();
        else if (message.reference) {
            const replied = await message.channel.messages.fetch(message.reference.messageId);
            targetUser = replied.author;
        }
        if (!targetUser) return message.reply("You must tag or reply to fake quote a user.");
        text = fakeQuote;
    } else if (message.reference) {
        const msg = await message.channel.messages.fetch(message.reference.messageId);
        targetUser = msg.author;
        text = getMessageText(msg);
        image = getImageFromMessage(msg);
    } else if (message.mentions.users.size) {
        return message.reply("Use quotes \"like this\" to fake quote a user.");
    } else {
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

    // Hyperlink buttons with 🌐 emoji only
    const linkURLs = extractURLs(text);
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

    try { await message.delete(); } catch {}
});

client.login(process.env.TOKEN);