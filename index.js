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

// -------- Fonts
Canvas.registerFont(path.join(__dirname, 'fonts', 'NotoSans-Regular.ttf'), { family: 'NotoSans' });
Canvas.registerFont(path.join(__dirname, 'fonts', 'NotoEmoji-Regular.ttf'), { family: 'NotoEmoji' });
Canvas.registerFont(path.join(__dirname, 'fonts', 'NotoSansSymbols-Regular.ttf'), { family: 'NotoSymbols' });
Canvas.registerFont(path.join(__dirname, 'fonts', 'NotoSansSymbols2-Regular.ttf'), { family: 'NotoSymbols2' });
Canvas.registerFont(path.join(__dirname, 'fonts', 'NotoSansMath-Regular.ttf'), { family: 'NotoMath' });

const WILDCARD_TRIGGERS = ['quote', 'ass'];

// -------- Helpers
function extractURLs(text) {
    return text.match(/https?:\/\/[^\s]+/gi) || [];
}

function sanitizeLinks(text) {
    return text.replace(/https?:\/\/[^\s]+/gi, '🌐');
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

// -------- Top Reaction Fetch
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

// -------- Text Wrap with line break support
function wrapText(ctx, text, maxWidth, maxHeight, maxFontSize) {
    let fontSize = maxFontSize;
    let lines = [];

    // sanitize excessive line breaks (no more than 2 consecutive)
    text = text.replace(/\n{3,}/g, '\n\n');

    while (fontSize > 12) {
        ctx.font = `${fontSize}px "NotoSans", "NotoEmoji", "NotoSymbols", "NotoSymbols2", "NotoMath"`;
        lines = [];

        const paragraphs = text.split('\n');
        for (let para of paragraphs) {
            let words = para.split(' ');
            let line = '';

            for (let word of words) {
                if (ctx.measureText(word).width > maxWidth) {
                    let part = '';
                    for (let c of word) {
                        if (ctx.measureText(part + c + '-').width > maxWidth) {
                            lines.push(part + '-');
                            part = c;
                        } else part += c;
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
        }

        let height = lines.length * fontSize * 1.2;
        if (height <= maxHeight) break;

        fontSize -= 2;
    }

    return { lines, fontSize };
}

// -------- Image Generation
async function generateQuoteImage(text, username, avatarURL, serverName, displayName, imageUrl) {
    const width = 1000;
    const height = 400;
    const padding = 50;
    const metadataHeight = 80;

    const canvas = Canvas.createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);

    const avatar = await Canvas.loadImage(
        await sharp(await (await fetch(avatarURL)).buffer()).png().toBuffer()
    );
    ctx.drawImage(avatar, 0, 0, height, height);

    const contentX = height + padding;
    const contentWidth = width - height - padding * 2;
    const contentHeight = height - padding * 2 - metadataHeight;

    // IMAGE ONLY MODE
    if (imageUrl) {
        try {
            const img = await Canvas.loadImage(imageUrl);
            const scale = Math.min(contentWidth / img.width, contentHeight / img.height);
            const w = img.width * scale;
            const h = img.height * scale;
            ctx.drawImage(img, contentX + (contentWidth - w) / 2, padding + (contentHeight - h) / 2, w, h);
        } catch {}
    } else {
        text = `"${sanitizeLinks(text)}"`;
        const { lines, fontSize } = wrapText(ctx, text, contentWidth, contentHeight, 64);

        ctx.fillStyle = '#fff';
        if (lines.length === 1) {
            let size = fontSize + 14;
            ctx.font = `${size}px "NotoSans", "NotoEmoji", "NotoSymbols", "NotoSymbols2", "NotoMath"`;
            const textWidth = ctx.measureText(lines[0]).width;
            ctx.fillText(lines[0], contentX + (contentWidth - textWidth) / 2, height / 2 + size / 3);
        } else {
            let totalHeight = lines.length * fontSize * 1.2;
            let y = padding + (contentHeight - totalHeight) / 2;
            for (let line of lines) {
                ctx.font = `${fontSize}px "NotoSans", "NotoEmoji", "NotoSymbols", "NotoSymbols2", "NotoMath"`;
                ctx.fillText(line, contentX, y + fontSize);
                y += fontSize * 1.2;
            }
        }
    }

    // -------- METADATA
    ctx.font = `24px "NotoSans", "NotoSymbols", "NotoSymbols2", "NotoMath"`;
    ctx.fillStyle = '#d580ff';
    ctx.fillText(`- ${serverName}`, contentX, height - 70);

    ctx.fillStyle = '#fff';
    ctx.fillText(`${displayName} (@${username})`, contentX, height - 40);

    return canvas.toBuffer();
}

// -------- MAIN
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    let target = null;
    const content = message.content.trim().toLowerCase();

    // FALSE QUOTE (updated)
    const match = message.content.match(/^quote\s+<@!?(\d+)>\s*"?([\s\S]+?)"?$/i);
    if (match) {
        try {
            const user = await message.guild.members.fetch(match[1]);
            target = { author: user.user, content: match[2] };
        } catch {
            return message.reply('Failed, use quotes "like this" to fake quote a user.');
        }
    }

    else if (message.reference && WILDCARD_TRIGGERS.some(t => content.includes(t))) {
        target = await message.channel.messages.fetch(message.reference.messageId);
    }

    else if (content.startsWith('quote') && message.mentions.users.size) {
        const user = message.mentions.users.first();
        target = await getTopReactionMessageGlobal(message.guild, user.id);
        if (!target) return message.reply("No messages found.");
    }

    else if (content.startsWith('quote')) {
        let txt = message.content.replace(/^quote\s*/i, '');
        target = { ...message, content: txt };
    } else return;

    // Ensure we get displayName from server nickname
    const member = message.guild?.members.cache.get(target.author.id) || await message.guild?.members.fetch(target.author.id).catch(() => null);
    const displayName = member?.displayName || target.author.username;

    const image = getImageFromMessage(target);
    const links = extractURLs(target.content);

    const buffer = await generateQuoteImage(
        target.content,
        target.author.username,
        target.author.displayAvatarURL({ format: 'png', size: 256 }),
        message.guild?.name || 'DM',
        displayName,
        image
    );

    let components = [];
    if (links.length) {
        const row = new ActionRowBuilder();
        links.slice(0, 5).forEach(url => {
            row.addComponents(
                new ButtonBuilder().setLabel('🌐').setStyle(ButtonStyle.Link).setURL(url)
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