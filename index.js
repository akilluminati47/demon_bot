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

// ---------------- Fonts ----------------
Canvas.registerFont(path.join(__dirname, 'fonts', 'NotoSans-Regular.ttf'), { family: 'NotoSans' });
Canvas.registerFont(path.join(__dirname, 'fonts', 'NotoColorEmoji-Regular.ttf'), { family: 'NotoEmoji' });
Canvas.registerFont(path.join(__dirname, 'fonts', 'NotoSansSymbols-Regular.ttf'), { family: 'NotoSymbols' });
Canvas.registerFont(path.join(__dirname, 'fonts', 'NotoSansSymbols2-Regular.ttf'), { family: 'NotoSymbols2' });
Canvas.registerFont(path.join(__dirname, 'fonts', 'NotoSansMath-Regular.ttf'), { family: 'NotoMath' });

const WILDCARD_TRIGGERS = ['quote', 'ass'];

// ---------------- Helpers ----------------
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

// ---------------- Text Wrapping ----------------
function wrapText(ctx, text, maxWidth, maxHeight, maxFontSize) {
    let fontSize = maxFontSize;
    let lines = [];
    const paragraphs = text.split(/\r?\n/);

    while (fontSize > 10) {
        ctx.font = `${fontSize}px "NotoSans", "NotoEmoji"`;
        lines = [];
        for (let para of paragraphs) {
            if (!para.trim()) { lines.push(''); continue; }
            let words = para.split(' ');
            let line = '';
            for (let word of words) {
                if (ctx.measureText(word).width > maxWidth) {
                    // Hyphenation
                    let part = '';
                    for (let c of word) {
                        if (ctx.measureText(part + c + '-').width > maxWidth) {
                            lines.push(part + '-');
                            part = c;
                        } else { part += c; }
                    }
                    line = part + ' ';
                } else {
                    let test = line + word + ' ';
                    if (ctx.measureText(test).width > maxWidth) {
                        if (line) lines.push(line.trim());
                        line = word + ' ';
                    } else { line = test; }
                }
            }
            if (line) lines.push(line.trim());
        }

        const totalHeight = lines.length * fontSize * 1.2;
        if (totalHeight <= maxHeight) break;
        fontSize -= 2;
    }

    return { lines, fontSize };
}

// ---------------- Generate Quote Image ----------------
async function generateQuoteImage(text, username, avatarURL, serverName, nickname) {
    const width = 1000;
    const height = 400;
    const padding = 40;
    const metadataHeight = 80;
    const topPadding = 30;

    const canvas = Canvas.createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // Background
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);

    // Avatar
    const avatarBuffer = await (await fetch(avatarURL)).buffer();
    const avatarImg = await Canvas.loadImage(await sharp(avatarBuffer).png().toBuffer());
    ctx.drawImage(avatarImg, 0, 0, height, height);

    const contentX = height + padding;
    const contentWidth = width - height - padding * 2;
    const contentHeight = height - padding * 2 - metadataHeight;

    // Text
    text = text ? `"${sanitizeLinks(text)}"` : '';
    const { lines, fontSize } = wrapText(ctx, text, contentWidth, contentHeight, 60);

    // Vertical centering for one-liners
    const nonEmptyLines = lines.filter(l => l.trim() !== '');
    const totalTextHeight = nonEmptyLines.length * fontSize * 1.2;
    let yStart = padding + topPadding;
    if (totalTextHeight < contentHeight) yStart += (contentHeight - totalTextHeight) / 2;

    ctx.fillStyle = '#fff';
    let y = yStart;
    for (let line of lines) {
        ctx.font = `${fontSize}px "NotoSans", "NotoEmoji"`;
        ctx.fillText(line, contentX, y + fontSize);
        y += fontSize * 1.2;
    }

    // Metadata
    const isBot = nickname.toLowerCase() === username.toLowerCase(); // display nickname for bots
    ctx.font = '24px "NotoSans"';
    ctx.fillStyle = '#d580ff';
    ctx.fillText(`- ${serverName}`, contentX, height - 70);
    ctx.fillStyle = '#fff';
    ctx.fillText(`${isBot ? nickname : nickname} (@${username})`, contentX, height - 40);

    return canvas.toBuffer();
}

// ---------------- Auto React ----------------
async function autoReact(message) {
    if (message.channel.name === 'news-spam') {
        await message.react('🔌'); // plug_alert
        await message.react('🟣'); // yappatron
    } else if (message.channel.name === 'twitch-youtube-plugs') {
        await message.react('🔌'); // plug_alert
    }
}

// ---------------- Top Reaction ----------------
async function getTopReactionMessageGlobal(guild, userId) {
    let top = null, maxReacts = 0;
    const channels = await guild.channels.fetch();
    for (const [, channel] of channels) {
        if (!channel.isTextBased()) continue;
        try {
            const messages = await channel.messages.fetch({ limit: 50 });
            messages.forEach(msg => {
                if (msg.author.id === userId && msg.reactions.cache.size) {
                    let count = 0;
                    msg.reactions.cache.forEach(r => count += r.count);
                    if (count > maxReacts) { maxReacts = count; top = msg; }
                }
            });
        } catch {}
    }
    return top;
}

// ---------------- Message Handler ----------------
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    autoReact(message).catch(() => {});

    let targetMessage = null;
    const content = message.content.trim();

    // False quote: quote @user "text"
    const falseQuoteMatch = content.match(/^quote\s+<@!?(\d+)>\s+"(.+)"$/i);
    if (falseQuoteMatch) {
        const userId = falseQuoteMatch[1];
        const fakeText = falseQuoteMatch[2];
        const user = await message.guild.members.fetch(userId);
        if (!user) return;
        targetMessage = { author: user.user, content: fakeText };
    } else if (message.reference && WILDCARD_TRIGGERS.some(t => content.toLowerCase().includes(t))) {
        targetMessage = await message.channel.messages.fetch(message.reference.messageId);
    } else if (content.toLowerCase().startsWith('quote') && message.mentions.users.size) {
        const user = message.mentions.users.first();
        targetMessage = await getTopReactionMessageGlobal(message.guild, user.id);
        if (!targetMessage) return message.reply('No messages found.');
    } else if (content.toLowerCase().startsWith('quote')) {
        let cleaned = message.content.replace(/^quote\s*/i, '');
        if (!cleaned.trim()) cleaned = message.content;
        targetMessage = { ...message, content: cleaned };
    } else return;

    const text = getMessageText(targetMessage);
    const linkURLs = extractURLs(text);

    const buffer = await generateQuoteImage(
        text,
        targetMessage.author.username,
        targetMessage.author.displayAvatarURL({ format: 'png', size: 256 }),
        message.guild?.name || 'DM',
        message.guild?.members.cache.get(targetMessage.author.id)?.displayName || targetMessage.author.username
    );

    // Buttons
    let components = [];
    if (linkURLs.length > 0) {
        const row = new ActionRowBuilder();
        linkURLs.slice(0, 5).forEach(url => {
            row.addComponents(
                new ButtonBuilder().setLabel('🌐').setStyle(ButtonStyle.Link).setURL(url)
            );
        });
        components.push(row);
    }

    await message.channel.send({ files: [{ attachment: buffer, name: 'quote.png' }], components });
    try { await message.delete(); } catch {}
});

client.login(process.env.TOKEN);