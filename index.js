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

// ✅ USE NON-COLOR EMOJI FONT
Canvas.registerFont(path.join(__dirname, 'fonts', 'NotoSans-Regular.ttf'), { family: 'NotoSans' });
Canvas.registerFont(path.join(__dirname, 'fonts', 'NotoEmoji-Regular.ttf'), { family: 'NotoEmoji' });

function extractURLs(text) {
    return text.match(/https?:\/\/[^\s]+/gi) || [];
}

function sanitizeLinks(text) {
    return text.replace(/https?:\/\/[^\s]+/gi, '🌐');
}

// -------- TEXT WRAP (SAFE + HYPHEN)
function wrapText(ctx, text, maxWidth, maxHeight, maxFontSize) {
    let fontSize = maxFontSize;
    let lines = [];

    while (fontSize > 12) {
        ctx.font = `${fontSize}px "NotoSans", "NotoEmoji"`;
        lines = [];

        let words = text.split(' ');
        let line = '';

        for (let word of words) {

            // 🔥 BREAK MASSIVE WORDS
            if (ctx.measureText(word).width > maxWidth) {
                let part = '';
                for (let c of word) {
                    if (ctx.measureText(part + c + '-').width > maxWidth) {
                        lines.push(part + '-');
                        part = c;
                    } else {
                        part += c;
                    }
                }
                line = part + ' ';
                continue;
            }

            let test = line + word + ' ';
            if (ctx.measureText(test).width > maxWidth) {
                lines.push(line.trim());
                line = word + ' ';
            } else {
                line = test;
            }
        }

        if (line) lines.push(line.trim());

        let height = lines.length * fontSize * 1.2;
        if (height <= maxHeight) break;

        fontSize -= 2;
    }

    return { lines, fontSize };
}

// -------- IMAGE GENERATION
async function generateQuoteImage(text, username, avatarURL, serverName, nickname) {

    const width = 1000;
    const height = 400;

    const padding = 50;
    const metadataHeight = 80;

    const canvas = Canvas.createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // background
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);

    // avatar
    const avatar = await Canvas.loadImage(
        await sharp(await (await fetch(avatarURL)).buffer()).png().toBuffer()
    );
    ctx.drawImage(avatar, 0, 0, height, height);

    const contentX = height + padding;
    const contentWidth = width - height - padding * 2;
    const contentHeight = height - padding * 2 - metadataHeight;

    text = `"${sanitizeLinks(text)}"`;

    const { lines, fontSize } = wrapText(ctx, text, contentWidth, contentHeight, 64);

    const isSingle = lines.length === 1;

    ctx.fillStyle = '#fff';

    // 🔥 RESTORE OLD ONE-LINER STYLE
    if (isSingle) {
        let size = fontSize + 14; // boost size
        ctx.font = `${size}px "NotoSans", "NotoEmoji"`;

        const textWidth = ctx.measureText(lines[0]).width;

        ctx.fillText(
            lines[0],
            contentX + (contentWidth - textWidth) / 2,
            height / 2 + size / 3
        );
    } else {
        // normal multi-line
        let totalHeight = lines.length * fontSize * 1.2;
        let y = padding + (contentHeight - totalHeight) / 2;

        for (let line of lines) {
            ctx.font = `${fontSize}px "NotoSans", "NotoEmoji"`;
            ctx.fillText(line, contentX, y + fontSize);
            y += fontSize * 1.2;
        }
    }

    // metadata
    ctx.font = '24px "NotoSans"';
    ctx.fillStyle = '#d580ff';
    ctx.fillText(`- ${serverName}`, contentX, height - 70);

    ctx.fillStyle = '#fff';

    // 🔥 BOT NAME FIX
    const display = nickname || username;
    ctx.fillText(display, contentX, height - 40);

    return canvas.toBuffer();
}

// -------- REACTION SCAN
async function getTopReactionMessageGlobal(guild, userId) {
    let top = null;
    let max = 0;

    const channels = await guild.channels.fetch();

    for (const [, ch] of channels) {
        if (!ch.isTextBased()) continue;

        try {
            const msgs = await ch.messages.fetch({ limit: 50 });

            msgs.forEach(m => {
                if (m.author.id === userId && m.reactions.cache.size) {
                    let count = 0;
                    m.reactions.cache.forEach(r => count += r.count);
                    if (count > max) {
                        max = count;
                        top = m;
                    }
                }
            });
        } catch {}
    }

    return top;
}

// -------- MAIN HANDLER
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    let target = null;
    const content = message.content.trim();

    // 🔥 FALSE QUOTE FIXED
    const match = content.match(/^quote\s+<@!?(\d+)>\s+"([\s\S]+)"$/i);
    if (match) {
        const user = await message.guild.members.fetch(match[1]);
        target = { author: user.user, content: match[2] };
    }

    // reply quote
    else if (message.reference && content.toLowerCase().includes('quote')) {
        target = await message.channel.messages.fetch(message.reference.messageId);
    }

    // normal mention quote
    else if (content.startsWith('quote') && message.mentions.users.size) {
        const user = message.mentions.users.first();
        target = await getTopReactionMessageGlobal(message.guild, user.id);
        if (!target) return;
    }

    // self quote
    else if (content.startsWith('quote')) {
        let txt = content.replace(/^quote\s*/i, '');
        target = { ...message, content: txt };
    } else return;

    const text = target.content;
    const links = extractURLs(text);

    const buffer = await generateQuoteImage(
        text,
        target.author.username,
        target.author.displayAvatarURL({ format: 'png', size: 256 }),
        message.guild?.name || 'DM',
        message.guild?.members.cache.get(target.author.id)?.displayName
    );

    let components = [];

    if (links.length) {
        const row = new ActionRowBuilder();
        links.slice(0, 5).forEach(url => {
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