require('dotenv').config();
const { Client, GatewayIntentBits, Partials, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const Canvas = require('canvas');
const fetch = require('node-fetch');
const sharp = require('sharp');
const { registerFont } = require('canvas');
const path = require('path');

// Register all Noto fonts
registerFont(path.join(__dirname, 'fonts', 'NotoSans-Regular.ttf'), { family: 'NotoSans' });
registerFont(path.join(__dirname, 'fonts', 'NotoColorEmoji.ttf'), { family: 'NotoEmoji' });
registerFont(path.join(__dirname, 'fonts', 'NotoSansSymbols-Regular.ttf'), { family: 'NotoSymbols' });
registerFont(path.join(__dirname, 'fonts', 'NotoSansSymbols2-Regular.ttf'), { family: 'NotoSymbols2' });

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

function sanitizeText(text) {
    const charMap = {
        '𝔸':'A','𝔹':'B','ℂ':'C','𝔻':'D','𝔼':'E','𝔽':'F','𝔾':'G',
        'ℍ':'H','𝕀':'I','𝕁':'J','𝕂':'K','𝕃':'L','𝕄':'M','ℕ':'N',
        '𝕆':'O','ℙ':'P','ℚ':'Q','ℝ':'R','𝕊':'S','𝕋':'T','𝕌':'U',
        '𝕍':'V','𝕎':'W','𝕏':'X','𝕐':'Y','ℤ':'Z',
        '𝕒':'a','𝕓':'b','𝕔':'c','𝕕':'d','𝕖':'e','𝕗':'f','𝕘':'g',
        '𝕙':'h','𝕚':'i','𝕛':'j','𝕜':'k','𝕝':'l','𝕞':'m','𝕟':'n',
        '𝕠':'o','𝕡':'p','𝕢':'q','𝕣':'r','𝕤':'s','𝕥':'t','𝕦':'u',
        '𝕧':'v','𝕨':'w','𝕩':'x','𝕪':'y','𝕫':'z'
    };
    return text.split('').map(c => charMap[c] || c).join('');
}

function wrapTextGolden(ctx, text, maxWidth, maxHeight, maxFontSize) {
    let fontSize = maxFontSize;
    let lines = [];

    while (fontSize > 10) {
        ctx.font = `${fontSize}px "NotoSans", "NotoSymbols", "NotoSymbols2", "NotoEmoji"`;
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

function extractURLs(text) {
    const urls = [];
    const raw = text.match(/https?:\/\/[^\s\)]+/gi) || [];
    urls.push(...raw);
    const md = [...text.matchAll(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/gi)];
    md.forEach(m => urls.push(m[2]));
    return urls;
}

async function generateQuoteImage(text, username, avatarURL, serverName, nickname) {
    const width = 1000;
    const height = 400;
    const canvas = Canvas.createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // Black background right side
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, width, height);

    // Avatar left side
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

    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'top';
    lines.forEach(line => {
        ctx.font = `${fontSize}px "NotoSans", "NotoSymbols", "NotoSymbols2", "NotoEmoji"`;
        const textWidth = ctx.measureText(line).width;
        ctx.fillText(line, blackX + (blackWidth - textWidth) / 2, quoteY);
        quoteY += fontSize * 1.2;
    });

    // Server name
    const serverFont = Math.floor(fontSize * 0.4);
    ctx.font = `${serverFont}px "NotoSans", "NotoSymbols", "NotoSymbols2", "NotoEmoji"`;
    ctx.shadowColor = '#8e2eff';
    ctx.shadowBlur = 15;
    ctx.fillStyle = '#d19eff';
    ctx.fillText(`- ${serverName}`, avatarSize + padding, height - 80);

    // Nickname + username
    const userFont = Math.floor(fontSize * 0.3);
    ctx.font = `${userFont}px "NotoSans", "NotoSymbols", "NotoSymbols2", "NotoEmoji"`;
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(`${nickname} (@${username})`, avatarSize + padding, height - 50);

    return canvas.toBuffer();
}

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