require('dotenv').config();
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const Canvas = require('canvas');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ],
    partials: [Partials.Channel]
});

const PREFIX = "!quote";

client.on('ready', () => {
    console.log(`Logged in as ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (!message.content.startsWith(PREFIX)) return;

    let targetMessage;

    // ✅ CASE 1: Reply
    if (message.reference) {
        try {
            targetMessage = await message.channel.messages.fetch(message.reference.messageId);
        } catch {
            return message.reply("Couldn't fetch the replied message.");
        }
    } else {
        // ✅ CASE 2: Last message from mentioned user OR author
        let targetUser = message.mentions.users.first() || message.author;

        const messages = await message.channel.messages.fetch({ limit: 50 });

        targetMessage = messages.find(
            m => m.author.id === targetUser.id && !m.author.bot && m.id !== message.id
        );

        if (!targetMessage) {
            return message.reply("Couldn't find a recent message from that user.");
        }
    }

    const text = targetMessage.content;
    const user = targetMessage.author;

    if (!text) return message.reply("That message has no text.");

    // 🎨 Canvas setup
    const width = 800;
    const height = 300;

    const canvas = Canvas.createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // Background
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, width, height);

    // Avatar
    const avatar = await Canvas.loadImage(
        user.displayAvatarURL({ extension: 'png', size: 256 })
    );

    ctx.drawImage(avatar, 0, 0, 300, 300);

    // Gradient fade
    const gradient = ctx.createLinearGradient(300, 0, 450, 0);
    gradient.addColorStop(0, "rgba(0,0,0,0)");
    gradient.addColorStop(1, "rgba(0,0,0,1)");

    ctx.fillStyle = gradient;
    ctx.fillRect(300, 0, 150, height);

    // Text styling
    ctx.fillStyle = "#ffffff";
    ctx.font = "28px sans-serif";

    function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
        const words = text.split(' ');
        let line = '';

        for (let n = 0; n < words.length; n++) {
            const testLine = line + words[n] + ' ';
            const metrics = ctx.measureText(testLine);
            const testWidth = metrics.width;

            if (testWidth > maxWidth && n > 0) {
                ctx.fillText(line, x, y);
                line = words[n] + ' ';
                y += lineHeight;
            } else {
                line = testLine;
            }
        }
        ctx.fillText(line, x, y);
    }

    // Quote text
    wrapText(ctx, `"${text}"`, 350, 130, 400, 35);

    // Username
    ctx.fillStyle = "#aaaaaa";
    ctx.font = "20px sans-serif";
    ctx.fillText(`- ${user.username}`, 350, 200);

    const attachment = {
        files: [{
            attachment: canvas.toBuffer(),
            name: 'quote.png'
        }]
    };

    message.reply(attachment);
});

client.login(process.env.TOKEN);