require('dotenv').config();
const { Client, GatewayIntentBits, Partials, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const Canvas = require('canvas');
const fetch = require('node-fetch');
const sharp = require('sharp');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions
    ],
    partials: [Partials.Channel, Partials.Message, Partials.Reaction]
});

client.once('clientReady', () => {
    console.log(`Logged in as ${client.user.tag}`);
});

const GOLDEN_RATIO = 1.618;

// -------------------------
// Aggressive sanitize function (nickname/username only)
// -------------------------
function sanitizeText(text) {
    let sanitized = text.normalize('NFKD');
    sanitized = sanitized.replace(/([^\p{Emoji}\u0000-\u007F])/gu, match => {
        const charMap = {
            '𝔸':'A','𝔹':'B','ℂ':'C','𝔻':'D','𝔼':'E','𝔽':'F','𝔾':'G',
            'ℍ':'H','𝕀':'I','𝕁':'J','𝕂':'K','𝕃':'L','𝕄':'M','ℕ':'N',
            '𝕆':'O','ℙ':'P','ℚ':'Q','ℝ':'R','𝕊':'S','𝕋':'T','𝕌':'U',
            '𝕍':'V','𝕎':'W','𝕏':'X','𝕐':'Y','ℤ':'Z',
            '𝕒':'a','𝕓':'b','𝕔':'c','𝕕':'d','𝕖':'e','𝕗':'f','𝕘':'g',
            '𝕙':'h','𝕚':'i','𝕛':'j','𝕜':'k','𝕝':'l','𝕞':'m','𝕟':'n',
            '𝕠':'o','𝕡':'p','𝕢':'q','𝕣':'r','𝕤':'s','𝕥':'t','𝕦':'u',
            '𝕧':'v','𝕨':'w','𝕩':'x','𝕪':'y','𝕫':'z',
            '𝟘':'0','𝟙':'1','𝟚':'2','𝟛':'3','𝟜':'4','𝟝':'5','𝟞':'6','𝟟':'7','𝟠':'8','𝟡':'9'
        };
        return charMap[match] || '?';
    });
    return sanitized;
}

// -------------------------
// Wrap quote text using golden ratio
// -------------------------
function wrapTextGolden(ctx, text, maxWidth, maxHeight, maxFontSize) {
    let fontSize = maxFontSize;
    let lines = [];

    while (fontSize > 10) {
        ctx.font = `${fontSize}px "Arial Unicode MS", "Noto Sans Symbols", "Noto Sans", Sans`;
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

// -------------------------
// Get top reaction message from a user
// -------------------------
async function getTopReactionMessage(channel, userId) {
    const messages = await channel.messages.fetch({ limit: 100 });
    let top = null;
    let maxReacts = 0;
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
    return top;
}

// -------------------------
// Extract URLs for emoji buttons
// -------------------------
function extractURLs(text) {
    const urls = [];
    const raw = text.match(/https?:\/\/[^\s\)]+/gi) || [];
    urls.push(...raw);
    const md = [...text.matchAll(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/gi)];
    md.forEach(m => urls.push(m[2]));
    return urls;
}

// -------------------------
// Generate quote image
// -------------------------
async function generateQuoteImage(text, username, avatarURL, serverName, nickname) {
    const width = 1000;
    const height = 400;
    const canvas = Canvas.createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // Black background
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, width, height);

    // Avatar
    const response = await fetch(avatarURL);
    const avatarBuffer = await response.buffer();
    const pngBuffer = await sharp(avatarBuffer).png().toBuffer();
    const avatar = await Canvas.loadImage(pngBuffer);
    const avatarSize = height;
    ctx.drawImage(avatar, 0, 0, avatarSize, avatarSize);

    const padding = 30;
    const blackX = avatarSize + padding;
    const blackY = padding;
    const blackWidth = width - avatarSize - padding * 2;
    const blackHeight = height - padding * 2;

    text = sanitizeText(`"${text}"`);
    const goldenHeight = blackHeight / GOLDEN_RATIO;
    const { lines, fontSize } = wrapTextGolden(ctx, text, blackWidth, goldenHeight, 60);

    const totalTextHeight = lines.length * fontSize * 1.2;
    const metaHeight = 100;
    let quoteY = blackY + (blackHeight - totalTextHeight - metaHeight) / 2;

    // Draw quote text
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'top';
    lines.forEach(line => {
        ctx.font = `${fontSize}px "Arial Unicode MS", "Noto Sans Symbols", "Noto Sans", Sans`;
        const textWidth = ctx.measureText(line).width;
        ctx.fillText(line, blackX + (blackWidth - textWidth) / 2, quoteY);
        quoteY += fontSize * 1.2;
    });

    // Server name with purple glow (fancy letters preserved)
    const serverFont = Math.floor(fontSize * 0.4);
    ctx.font = `${serverFont}px Sans`;
    ctx.fillStyle = '#9b59b6';
    ctx.shadowColor = '#a569bd';
    ctx.shadowBlur = 10;
    ctx.fillText(`- ${serverName}`, avatarSize + padding, height - 85);

    // Reset shadow for nickname/username
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#ffffff';
    const userFont = Math.floor(fontSize * 0.3);
    ctx.font = `${userFont}px Sans`;
    ctx.fillText(`${sanitizeText(nickname)} (@${sanitizeText(username)})`, avatarSize + padding, height - 55);

    return canvas.toBuffer();
}

// -------------------------
// Wildcard triggers
// -------------------------
const wildcardTriggers = ['quote', 'ass'];

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    const content = message.content.toLowerCase();
    let targetMessage = null;
    let linkURLs = [];

    if (content.startsWith('quote') && message.mentions.users.size) {
        const user = message.mentions.users.first();
        targetMessage = await getTopReactionMessage(message.channel, user.id);
        if (!targetMessage) return message.reply("No messages with reactions found for that user.");
    }
    else if (message.reference && wildcardTriggers.some(t => content.includes(t))) {
        try {
            targetMessage = await message.channel.messages.fetch(message.reference.messageId);
        } catch {
            return message.reply("Couldn't fetch the replied message.");
        }
    }
    else if (content.startsWith('quote')) {
        targetMessage = message;
    } else {
        return;
    }

    linkURLs = extractURLs(targetMessage.content);
    let text = targetMessage.content
        .replace(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/gi, '🌐')
        .replace(/https?:\/\/[^\s\)]+/gi, '🌐');

    const user = targetMessage.author;
    const guildMember = message.guild ? message.guild.members.cache.get(user.id) : null;
    const nickname = guildMember ? guildMember.displayName : user.username;
    const serverName = message.guild ? message.guild.name : 'DM';

    try {
        const buffer = await generateQuoteImage(
            text,
            user.username,
            user.displayAvatarURL({ format: 'png', size: 256 }),
            serverName,
            nickname
        );

        let row = null;
        if (linkURLs.length > 0) {
            row = new ActionRowBuilder();
            linkURLs.slice(0, 5).forEach(url => {
                const button = new ButtonBuilder()
                    .setLabel('🌐')
                    .setStyle(ButtonStyle.Link)
                    .setURL(url);
                row.addComponents(button);
            });
        }

        await message.channel.send({
            files: [{ attachment: buffer, name: 'quote.png' }],
            components: row ? [row] : []
        });
    } catch (err) {
        console.error(err);
        message.reply("Failed to generate quote image.");
    }
});

client.login(process.env.TOKEN);