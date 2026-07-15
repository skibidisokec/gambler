const { Client, GatewayIntentBits, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, SlashCommandBuilder, REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'data.json');
const STARTING_BALANCE = 1000;
const TOKEN = process.env.TOKEN;
const OWNER_ID = '919261954420383784';

function loadData() {
    if (!fs.existsSync(DATA_FILE)) {
        fs.writeFileSync(DATA_FILE, JSON.stringify({ balances: {} }));
        return { balances: {} };
    }
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function saveData(data) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function getBalance(userId) {
    const data = loadData();
    if (data.balances[userId] === undefined) {
        data.balances[userId] = STARTING_BALANCE;
        saveData(data);
    }
    return data.balances[userId];
}

function setBalance(userId, amount) {
    const data = loadData();
    data.balances[userId] = amount;
    saveData(data);
}

function addBalance(userId, amount) {
    const current = getBalance(userId);
    setBalance(userId, current + amount);
    return current + amount;
}

function bigWinEmbed(embed, username, payout) {
    if (payout >= 10000) {
        embed.setColor(0xFFD700).setFooter({ text: '🏆 LEGENDARY WIN 🏆' });
    }
    return embed;
}

function checkBet(interaction, amount) {
    if (amount <= 0) return 'You must bet a positive amount!';
    if (amount > getBalance(interaction.user.id)) return `You don't have enough coins! You have **${getBalance(interaction.user.id).toLocaleString()}** coins.`;
    return null;
}

const SUITS = ['♠', '♥', '♣', '♦'];
const VALUES = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

function createDeck() {
    const deck = [];
    for (const suit of SUITS) {
        for (const value of VALUES) {
            deck.push({ suit, value });
        }
    }
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

function cardValue(card) {
    if (['J', 'Q', 'K'].includes(card.value)) return 10;
    if (card.value === 'A') return 11;
    return parseInt(card.value);
}

function handValue(hand) {
    let value = 0;
    let aces = 0;
    for (const card of hand) {
        if (card.value === 'A') aces++;
        value += cardValue(card);
    }
    while (value > 21 && aces > 0) {
        value -= 10;
        aces--;
    }
    return value;
}

function cardDisplay(card) {
    return `${card.value}${card.suit}`;
}

function handDisplay(hand) {
    return hand.map(c => cardDisplay(c)).join(' ');
}

const SLOT_ICONS = ['🍒', '🍋', '🍊', '🍇', '🔔', '💎', '7️⃣'];
const SLOT_PAYOUTS = {
    3: [0, 0, 0, 0, 3, 5, 10],
    2: [0, 0, 0, 0, 1, 2, 3]
};

const ROULETTE_NUMBERS = {
    0: { color: 'green' },
    1: { color: 'red' }, 2: { color: 'black' }, 3: { color: 'red' }, 4: { color: 'black' },
    5: { color: 'red' }, 6: { color: 'black' }, 7: { color: 'red' }, 8: { color: 'black' },
    9: { color: 'red' }, 10: { color: 'black' }, 11: { color: 'black' }, 12: { color: 'red' },
    13: { color: 'black' }, 14: { color: 'red' }, 15: { color: 'black' }, 16: { color: 'red' },
    17: { color: 'black' }, 18: { color: 'red' }, 19: { color: 'red' }, 20: { color: 'black' },
    21: { color: 'red' }, 22: { color: 'black' }, 23: { color: 'red' }, 24: { color: 'black' },
    25: { color: 'red' }, 26: { color: 'black' }, 27: { color: 'red' }, 28: { color: 'black' },
    29: { color: 'black' }, 30: { color: 'red' }, 31: { color: 'black' }, 32: { color: 'red' },
    33: { color: 'black' }, 34: { color: 'red' }, 35: { color: 'black' }, 36: { color: 'red' }
};

const games = new Map();
const minesGames = new Map();
const towersGames = new Map();
const crashGames = new Map();
const chickenGames = new Map();

const RESET_INTERVAL = 24 * 60 * 60 * 1000;
let nextResetTime = null;

function checkDailyReset() {
    const data = loadData();
    const now = Date.now();
    if (!data.lastReset) {
        data.lastReset = now;
        saveData(data);
        nextResetTime = now + RESET_INTERVAL;
        return;
    }
    if (now - data.lastReset >= RESET_INTERVAL) {
        for (const userId in data.balances) {
            data.balances[userId] = STARTING_BALANCE;
        }
        data.lastReset = now;
        saveData(data);
        nextResetTime = now + RESET_INTERVAL;
        console.log(`Daily reset completed at ${new Date().toLocaleString()}`);
    } else {
        nextResetTime = data.lastReset + RESET_INTERVAL;
    }
}

function msToTime(ms) {
    const hours = Math.floor(ms / (1000 * 60 * 60));
    const mins = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
    const secs = Math.floor((ms % (1000 * 60)) / 1000);
    return `${hours}h ${mins}m ${secs}s`;
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}!`);
    checkDailyReset();
    setInterval(checkDailyReset, 30000);

    const commands = [
        new SlashCommandBuilder().setName('balance').setDescription('Check your coin balance'),
        new SlashCommandBuilder().setName('setbalance').setDescription('Set coin balance (owner only)')
            .addIntegerOption(o => o.setName('amount').setDescription('Amount').setRequired(true))
            .addUserOption(o => o.setName('user').setDescription('Target user')),
        new SlashCommandBuilder().setName('coinflip').setDescription('Flip a coin')
            .addStringOption(o => o.setName('choice').setDescription('Heads or Tails').setRequired(true)
                .addChoices({ name: 'Heads', value: 'heads' }, { name: 'Tails', value: 'tails' }))
            .addIntegerOption(o => o.setName('amount').setDescription('Bet amount').setRequired(true)),
        new SlashCommandBuilder().setName('blackjack').setDescription('Play Blackjack')
            .addIntegerOption(o => o.setName('bet').setDescription('Bet amount').setRequired(true)),
        new SlashCommandBuilder().setName('slots').setDescription('Play Slots')
            .addIntegerOption(o => o.setName('bet').setDescription('Bet amount').setRequired(true)),
        new SlashCommandBuilder().setName('roulette').setDescription('Play Roulette')
            .addIntegerOption(o => o.setName('bet').setDescription('Bet amount').setRequired(true))
            .addStringOption(o => o.setName('type').setDescription('Bet type').setRequired(true)
                .addChoices(
                    { name: 'Red', value: 'red' }, { name: 'Black', value: 'black' },
                    { name: 'Odd', value: 'odd' }, { name: 'Even', value: 'even' },
                    { name: '1-18', value: 'low' }, { name: '19-36', value: 'high' }))
            .addIntegerOption(o => o.setName('number').setDescription('Specific number (0-36, optional)').setMinValue(0).setMaxValue(36)),
        new SlashCommandBuilder().setName('mines').setDescription('Play Mines')
            .addIntegerOption(o => o.setName('bet').setDescription('Bet amount').setRequired(true)),
        new SlashCommandBuilder().setName('towers').setDescription('Play Towers')
            .addIntegerOption(o => o.setName('bet').setDescription('Bet amount').setRequired(true)),
        new SlashCommandBuilder().setName('crash').setDescription('Play Crash')
            .addIntegerOption(o => o.setName('bet').setDescription('Bet amount').setRequired(true))
            .addNumberOption(o => o.setName('multiplier').setDescription('Cash out at (e.g. 1.5, 2.0, 3.0)').setRequired(true)),
        new SlashCommandBuilder().setName('chicken').setDescription('Cross the road!')
            .addIntegerOption(o => o.setName('bet').setDescription('Bet amount').setRequired(true)),
        new SlashCommandBuilder().setName('plinko').setDescription('Play Plinko')
            .addIntegerOption(o => o.setName('bet').setDescription('Bet amount').setRequired(true)),
        new SlashCommandBuilder().setName('guess').setDescription('Guess a number 1-20')
            .addIntegerOption(o => o.setName('bet').setDescription('Bet amount').setRequired(true))
            .addIntegerOption(o => o.setName('number').setDescription('Your guess (1-20)').setRequired(true).setMinValue(1).setMaxValue(20))
    ].map(c => c.toJSON());

    try {
        const rest = new REST({ version: '10' }).setToken(TOKEN);
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log('Commands registered!');
    } catch (error) {
        console.error('Error registering commands:', error);
    }
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) {
        if (interaction.isButton()) {
            const id = interaction.customId;
            if (id.startsWith('mines_')) return handleMinesButton(interaction);
            if (id.startsWith('towers_')) return handleTowersButton(interaction);
            if (id.startsWith('chicken_')) return handleChickenButton(interaction);
            return handleBlackjackButton(interaction);
        }
        return;
    }

    switch (interaction.commandName) {
        case 'balance': return handleBalance(interaction);
        case 'setbalance': return handleSetBalance(interaction);
        case 'coinflip': return handleCoinflip(interaction);
        case 'blackjack': return handleBlackjack(interaction);
        case 'slots': return handleSlots(interaction);
        case 'roulette': return handleRoulette(interaction);
        case 'mines': return handleMines(interaction);
        case 'towers': return handleTowers(interaction);
        case 'crash': return handleCrash(interaction);
        case 'chicken': return handleChicken(interaction);
        case 'plinko': return handlePlinko(interaction);
        case 'guess': return handleGuess(interaction);
    }
});

async function handleBalance(interaction) {
    const b = getBalance(interaction.user.id);
    const t = nextResetTime ? msToTime(nextResetTime - Date.now()) : 'N/A';
    await interaction.reply({ embeds: [new EmbedBuilder().setColor(0x00ff00).setTitle('Balance').setDescription(`**${interaction.user.username}**, you have **${b.toLocaleString()}** coins.`).setFooter({ text: `Reset in: ${t}` }).setTimestamp()] });
}

async function handleSetBalance(interaction) {
    if (interaction.user.id !== OWNER_ID) return interaction.reply({ content: 'Owner only!', ephemeral: true });
    const amt = interaction.options.getInteger('amount');
    const t = interaction.options.getUser('user') || interaction.user;
    if (amt < 0) return interaction.reply({ content: 'No negatives!', ephemeral: true });
    setBalance(t.id, amt);
    await interaction.reply({ embeds: [new EmbedBuilder().setColor(0x00ff00).setTitle('Balance Updated').setDescription(`${t.id === interaction.user.id ? 'Your' : `${t.username}'s`} balance set to **${amt.toLocaleString()}** coins.`)] });
}

async function handleCoinflip(interaction) {
    const choice = interaction.options.getString('choice');
    const amt = interaction.options.getInteger('amount');
    const uid = interaction.user.id;
    const err = checkBet(interaction, amt);
    if (err) return interaction.reply({ content: err, ephemeral: true });
    const result = Math.random() < 0.5 ? 'heads' : 'tails';
    const won = choice === result;
    addBalance(uid, won ? amt : -amt);
    const big = won && amt >= 10000;
    const e = new EmbedBuilder().setColor(big ? 0xFFD700 : (won ? 0x00ff00 : 0xff0000))
        .setTitle(big ? '🎉💰🎉 MASSIVE WINNER! 🎉💰🎉' : 'Coin Flip')
        .setDescription(big ? `**🔥 ${interaction.user.username} just won ${amt.toLocaleString()} coins! 🔥**` : null)
        .addFields({ name: 'Choice', value: choice.charAt(0).toUpperCase() + choice.slice(1), inline: true },
            { name: 'Result', value: result.charAt(0).toUpperCase() + result.slice(1), inline: true },
            { name: 'Outcome', value: won ? `Won **${amt.toLocaleString()}** coins!` : `Lost **${amt.toLocaleString()}** coins...` },
            { name: 'Balance', value: `${getBalance(uid).toLocaleString()} coins` });
    if (big) e.setFooter({ text: '🏆 LEGENDARY WIN 🏆' });
    await interaction.reply({ embeds: [e] });
}

// ===================== BLACKJACK =====================

async function handleBlackjack(interaction) {
    const bet = interaction.options.getInteger('bet');
    const uid = interaction.user.id;
    const err = checkBet(interaction, bet);
    if (err) return interaction.reply({ content: err, ephemeral: true });
    if (games.has(uid)) return interaction.reply({ content: 'Finish your current game first!', ephemeral: true });
    const deck = createDeck();
    const ph = [deck.pop(), deck.pop()];
    const dh = [deck.pop(), deck.pop()];
    const pv = handValue(ph), dv = handValue(dh);
    if (pv === 21) {
        const payout = Math.floor(bet * 1.5);
        addBalance(uid, payout);
        const big = payout >= 10000;
        const e = new EmbedBuilder().setColor(big ? 0xFFD700 : 0x00ff00)
            .setTitle(big ? '🎉💰🎉 MASSIVE BLACKJACK! 🎉💰🎉' : 'Blackjack!')
            .setDescription(big ? `**🔥 ${interaction.user.username} hit a massive Blackjack! 🔥**` : '**Natural Blackjack! You win!**')
            .addFields({ name: `You (${pv})`, value: handDisplay(ph), inline: true }, { name: `Dealer (${dv})`, value: handDisplay(dh), inline: true }, { name: 'Payout', value: `+${payout.toLocaleString()} coins` }, { name: 'Balance', value: `${getBalance(uid).toLocaleString()} coins` });
        if (big) e.setFooter({ text: '🏆 LEGENDARY WIN 🏆' });
        return interaction.reply({ embeds: [e] });
    }
    addBalance(uid, -bet);
    games.set(uid, { deck, playerHand: ph, dealerHand: dh, bet, uid });
    const e = new EmbedBuilder().setColor(0x3498db).setTitle('Blackjack').setDescription(`**Bet: ${bet.toLocaleString()} coins**`)
        .addFields({ name: `You (${pv})`, value: handDisplay(ph) }, { name: `Dealer (${handValue([dh[0]])})`, value: `${cardDisplay(dh[0])} ?` });
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('hit').setLabel('Hit').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('stand').setLabel('Stand').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('double').setLabel('Double Down').setStyle(ButtonStyle.Danger));
    await interaction.reply({ embeds: [e], components: [row] });
}

async function handleBlackjackButton(interaction) {
    const uid = interaction.user.id;
    const g = games.get(uid);
    if (!g) return interaction.reply({ content: 'No active game!', ephemeral: true });
    const id = interaction.customId;
    if (id === 'hit') {
        g.playerHand.push(g.deck.pop());
        const v = handValue(g.playerHand);
        if (v > 21) { games.delete(uid); return interaction.update({ embeds: [new EmbedBuilder().setColor(0xff0000).setTitle('Bust!').setDescription(`**Lost ${g.bet.toLocaleString()} coins**`).addFields({ name: 'Your Hand', value: handDisplay(g.playerHand) }, { name: 'Value', value: `${v}` }, { name: 'Balance', value: `${getBalance(uid).toLocaleString()} coins` })], components: [] }); }
        if (v === 21) return finishBlackjack(interaction, g);
        const e = new EmbedBuilder().setColor(0x3498db).setTitle('Blackjack').setDescription(`**Bet: ${g.bet.toLocaleString()} coins**`)
            .addFields({ name: `You (${v})`, value: handDisplay(g.playerHand) }, { name: `Dealer (${handValue([g.dealerHand[0]])})`, value: `${cardDisplay(g.dealerHand[0])} ?` });
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('hit').setLabel('Hit').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('stand').setLabel('Stand').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('double').setLabel('Double Down').setStyle(ButtonStyle.Danger));
        return interaction.update({ embeds: [e], components: [row] });
    }
    if (id === 'stand') return finishBlackjack(interaction, g);
    if (id === 'double') {
        if (getBalance(uid) < g.bet) return interaction.reply({ content: 'Not enough coins to double!', ephemeral: true });
        addBalance(uid, -g.bet); g.bet *= 2;
        g.playerHand.push(g.deck.pop());
        const v = handValue(g.playerHand);
        if (v > 21) { games.delete(uid); return interaction.update({ embeds: [new EmbedBuilder().setColor(0xff0000).setTitle('Bust!').setDescription(`**Lost ${g.bet.toLocaleString()} coins**`).addFields({ name: 'Hand', value: handDisplay(g.playerHand) }, { name: 'Balance', value: `${getBalance(uid).toLocaleString()} coins` })], components: [] }); }
        return finishBlackjack(interaction, g);
    }
}

async function finishBlackjack(interaction, g) {
    const uid = g.uid;
    games.delete(uid);
    while (handValue(g.dealerHand) < 17) g.dealerHand.push(g.deck.pop());
    const pv = handValue(g.playerHand), dv = handValue(g.dealerHand);
    let r, c, big = false;
    if (dv > 21 || pv > dv) {
        addBalance(uid, g.bet * 2);
        r = dv > 21 ? `Dealer bust! Won ${g.bet.toLocaleString()}!` : `You win +${g.bet.toLocaleString()}!`;
        c = 0x00ff00;
        if (g.bet >= 10000) big = true;
    } else if (pv === dv) { addBalance(uid, g.bet); r = `Push! ${g.bet.toLocaleString()} returned.`; c = 0xffff00; }
    else { r = `Lost ${g.bet.toLocaleString()}...`; c = 0xff0000; }
    const e = new EmbedBuilder().setColor(big ? 0xFFD700 : c).setTitle(big ? '🎉💰🎉 MASSIVE WIN! 🎉💰🎉' : 'Blackjack')
        .setDescription(big ? `**🔥 ${interaction.user.username} pulled off a huge win! 🔥**` : null)
        .addFields({ name: `You (${pv})`, value: handDisplay(g.playerHand) }, { name: `Dealer (${dv})`, value: handDisplay(g.dealerHand) }, { name: 'Result', value: r }, { name: 'Balance', value: `${getBalance(uid).toLocaleString()} coins` });
    if (big) e.setFooter({ text: '🏆 LEGENDARY WIN 🏆' });
    await interaction.update({ embeds: [e], components: [] });
}

// ===================== SLOTS =====================

async function handleSlots(interaction) {
    const bet = interaction.options.getInteger('bet');
    const uid = interaction.user.id;
    const err = checkBet(interaction, bet);
    if (err) return interaction.reply({ content: err, ephemeral: true });

    const reels = [
        SLOT_ICONS[Math.floor(Math.random() * SLOT_ICONS.length)],
        SLOT_ICONS[Math.floor(Math.random() * SLOT_ICONS.length)],
        SLOT_ICONS[Math.floor(Math.random() * SLOT_ICONS.length)]
    ];

    let multiplier = 0;
    if (reels[0] === reels[1] && reels[1] === reels[2]) {
        const idx = SLOT_ICONS.indexOf(reels[0]);
        multiplier = SLOT_PAYOUTS['3'][idx];
    } else if (reels[0] === reels[1] || reels[1] === reels[2] || reels[0] === reels[2]) {
        const match = reels[0] === reels[1] ? reels[0] : reels[2];
        const idx = SLOT_ICONS.indexOf(match);
        multiplier = SLOT_PAYOUTS['2'][idx];
    }

    const winnings = Math.floor(bet * multiplier);
    const won = winnings > 0;
    if (won) addBalance(uid, winnings);
    else addBalance(uid, -bet);

    const big = won && winnings >= 10000;
    const e = new EmbedBuilder().setColor(big ? 0xFFD700 : (won ? 0x00ff00 : 0xff0000))
        .setTitle(big ? '🎰💰🎉 JACKPOT! 🎉💰🎰' : '🎰 Slots')
        .setDescription(`**${reels.join(' | ')}**`)
        .addFields({ name: 'Result', value: won ? `Won **${winnings.toLocaleString()}** coins (${multiplier}x)!` : `Lost **${bet.toLocaleString()}** coins...` },
            { name: 'Balance', value: `${getBalance(uid).toLocaleString()} coins` });
    if (big) e.setFooter({ text: '🏆 JACKPOT WINNER 🏆' });
    await interaction.reply({ embeds: [e] });
}

// ===================== ROULETTE =====================

async function handleRoulette(interaction) {
    const bet = interaction.options.getInteger('bet');
    const type = interaction.options.getString('type');
    const numBet = interaction.options.getInteger('number');
    const uid = interaction.user.id;
    const err = checkBet(interaction, bet);
    if (err) return interaction.reply({ content: err, ephemeral: true });

    const result = Math.floor(Math.random() * 37);
    const color = ROULETTE_NUMBERS[result].color;
    const parity = result === 0 ? 'neither' : (result % 2 === 0 ? 'even' : 'odd');
    const range = result === 0 ? 'none' : (result <= 18 ? 'low' : 'high');

    let won = false;
    let payout = 0;
    let desc = '';

    if (numBet !== null && result === numBet) {
        won = true;
        payout = bet * 35;
        desc = `**${result}** exact match! 35x payout!`;
    } else if (type === color) {
        won = true;
        payout = Math.floor(bet * 2);
        desc = `**${result} ${color}** — 2x payout!`;
    } else if (type === parity && parity === parity) {
        won = true;
        payout = Math.floor(bet * 2);
        desc = `**${result} (${parity})** — 2x payout!`;
    } else if (type === range && range === range) {
        won = true;
        payout = Math.floor(bet * 2);
        desc = `**${result} (${range})** — 2x payout!`;
    } else {
        payout = 0;
        desc = `**${result} ${color}** — not a match.`;
    }

    if (won) addBalance(uid, payout);
    else addBalance(uid, -bet);

    const profit = won ? payout : -bet;
    const big = won && profit >= 10000;
    const e = new EmbedBuilder().setColor(big ? 0xFFD700 : (won ? 0x00ff00 : 0xff0000))
        .setTitle(big ? '🎉💰🎉 ROULETTE WINNER! 🎉💰🎉' : '🎡 Roulette')
        .addFields({ name: 'Result', value: `**${result}** ${color === 'red' ? '🔴' : color === 'black' ? '⚫' : '🟢'}` },
            { name: 'Outcome', value: won ? `Won **${profit.toLocaleString()}** coins!` : `Lost **${bet.toLocaleString()}** coins...` },
            { name: 'Balance', value: `${getBalance(uid).toLocaleString()} coins` });
    if (big) e.setFooter({ text: '🏆 LEGENDARY WIN 🏆' });
    await interaction.reply({ embeds: [e] });
}

// ===================== MINES =====================

async function handleMines(interaction) {
    const bet = interaction.options.getInteger('bet');
    const uid = interaction.user.id;
    const err = checkBet(interaction, bet);
    if (err) return interaction.reply({ content: err, ephemeral: true });
    if (minesGames.has(uid)) return interaction.reply({ content: 'You already have a Mines game!', ephemeral: true });

    addBalance(uid, -bet);
    const grid = Array(9).fill('safe');
    const mines = new Set();
    while (mines.size < 3) mines.add(Math.floor(Math.random() * 9));
    for (const m of mines) grid[m] = 'mine';

    minesGames.set(uid, { grid, bet, revealed: new Set(), uid, alive: true });

    const e = new EmbedBuilder().setColor(0x9b59b6).setTitle('💣 Mines').setDescription(`**Bet: ${bet.toLocaleString()} coins**\nReveal tiles (💎 = safe, 💥 = mine). Cash out anytime!`);
    const row = buildMinesGrid(uid, new Set());
    await interaction.reply({ embeds: [e], components: row });
}

function buildMinesGrid(uid, revealed) {
    const rows = [];
    let btns = [];
    for (let i = 0; i < 9; i++) {
        const label = revealed.has(i) ? (minesGames.get(uid)?.grid[i] === 'mine' ? '💥' : '💎') : '⬜';
        btns.push(new ButtonBuilder().setCustomId(`mines_${i}`).setLabel(label).setStyle(revealed.has(i) ? (minesGames.get(uid)?.grid[i] === 'mine' ? ButtonStyle.Danger : ButtonStyle.Success) : ButtonStyle.Secondary).setDisabled(revealed.has(i)));
        if (btns.length === 3 || i === 8) {
            rows.push(new ActionRowBuilder().addComponents(btns));
            btns = [];
        }
    }
    rows.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('mines_cashout').setLabel('💰 Cash Out').setStyle(ButtonStyle.Primary)));
    return rows;
}

async function handleMinesButton(interaction) {
    const uid = interaction.user.id;
    const g = minesGames.get(uid);
    if (!g) return interaction.reply({ content: 'No active Mines game!', ephemeral: true });

    if (interaction.customId === 'mines_cashout') {
        const revealedCount = g.revealed.size;
        if (revealedCount === 0) { addBalance(uid, g.bet); minesGames.delete(uid); return interaction.update({ embeds: [new EmbedBuilder().setColor(0xffff00).setTitle('💣 Mines').setDescription(`No tiles revealed. Bet of **${g.bet.toLocaleString()}** returned.`)], components: [] }); }
        const multiplier = 1 + revealedCount * 0.5;
        const payout = Math.floor(g.bet * multiplier);
        addBalance(uid, payout);
        const big = payout >= 10000;
        minesGames.delete(uid);
        const e = new EmbedBuilder().setColor(big ? 0xFFD700 : 0x00ff00).setTitle(big ? '🎉💰🎉 MINES WIN! 🎉💰🎉' : '💣 Mines - Cashed Out')
            .setDescription(`Cashed out **${payout.toLocaleString()}** coins (${multiplier}x)!`).addFields({ name: 'Balance', value: `${getBalance(uid).toLocaleString()} coins` });
        if (big) e.setFooter({ text: '🏆 LEGENDARY WIN 🏆' });
        return interaction.update({ embeds: [e], components: [] });
    }

    const idx = parseInt(interaction.customId.split('_')[1]);
    if (g.revealed.has(idx)) return interaction.reply({ content: 'Already revealed!', ephemeral: true });

    g.revealed.add(idx);
    if (g.grid[idx] === 'mine') {
        minesGames.delete(uid);
        const e = new EmbedBuilder().setColor(0xff0000).setTitle('💣 Mines - BOOM!').setDescription(`**💥 Hit a mine! Lost ${g.bet.toLocaleString()} coins!**`).addFields({ name: 'Balance', value: `${getBalance(uid).toLocaleString()} coins` });
        return interaction.update({ embeds: [e], components: buildMinesGrid(uid, g.revealed) });
    }

    const e = new EmbedBuilder().setColor(0x9b59b6).setTitle('💣 Mines').setDescription(`**Bet: ${g.bet.toLocaleString()} coins** — ${g.revealed.size} safe revealed. Keep going or cash out!`);
    await interaction.update({ embeds: [e], components: buildMinesGrid(uid, g.revealed) });
}

// ===================== TOWERS =====================

async function handleTowers(interaction) {
    const bet = interaction.options.getInteger('bet');
    const uid = interaction.user.id;
    const err = checkBet(interaction, bet);
    if (err) return interaction.reply({ content: err, ephemeral: true });
    if (towersGames.has(uid)) return interaction.reply({ content: 'You already have a Towers game!', ephemeral: true });

    addBalance(uid, -bet);
    const levels = [];
    for (let i = 0; i < 5; i++) {
        const correct = Math.floor(Math.random() * 3);
        levels.push(correct);
    }
    towersGames.set(uid, { levels, bet, currentLevel: 0, uid, alive: true });

    const e = new EmbedBuilder().setColor(0xe67e22).setTitle('🏗️ Towers').setDescription(`**Bet: ${bet.toLocaleString()} coins**\nChoose a panel (🟦) to advance. Level ${1}/5`);
    const row = buildTowersRow(uid, 0);
    await interaction.reply({ embeds: [e], components: [row] });
}

function buildTowersRow(uid, level) {
    const choices = ['Left', 'Middle', 'Right'];
    return new ActionRowBuilder().addComponents(
        choices.map((c, i) => new ButtonBuilder().setCustomId(`towers_${i}`).setLabel(c).setStyle(ButtonStyle.Primary))
    );
}

async function handleTowersButton(interaction) {
    const uid = interaction.user.id;
    const g = towersGames.get(uid);
    if (!g) return interaction.reply({ content: 'No active Towers game!', ephemeral: true });

    const choice = parseInt(interaction.customId.split('_')[1]);
    const correct = g.levels[g.currentLevel];

    if (choice !== correct) {
        towersGames.delete(uid);
        const e = new EmbedBuilder().setColor(0xff0000).setTitle('🏗️ Towers - Fall!').setDescription(`**You fell! Lost ${g.bet.toLocaleString()} coins.**`).addFields({ name: 'Balance', value: `${getBalance(uid).toLocaleString()} coins` });
        return interaction.update({ embeds: [e], components: [] });
    }

    g.currentLevel++;
    if (g.currentLevel >= 5) {
        const mult = 5;
        const payout = Math.floor(g.bet * mult);
        addBalance(uid, payout);
        const big = payout >= 10000;
        towersGames.delete(uid);
        const e = new EmbedBuilder().setColor(big ? 0xFFD700 : 0x00ff00).setTitle(big ? '🎉💰🎉 TOWERS WINNER! 🎉💰🎉' : '🏗️ Towers - Cleared!')
            .setDescription(`**All 5 levels cleared! Won ${payout.toLocaleString()} coins (${mult}x)!**`).addFields({ name: 'Balance', value: `${getBalance(uid).toLocaleString()} coins` });
        if (big) e.setFooter({ text: '🏆 LEGENDARY WIN 🏆' });
        return interaction.update({ embeds: [e], components: [] });
    }

    const mult = 1 + g.currentLevel * 0.5;
    const e = new EmbedBuilder().setColor(0xe67e22).setTitle('🏗️ Towers').setDescription(`**Bet: ${g.bet.toLocaleString()} coins** — Cleared ${g.currentLevel}/5 (${mult}x so far). Next level!`);
    await interaction.update({ embeds: [e], components: [buildTowersRow(uid, g.currentLevel)] });
}

// ===================== CRASH =====================

async function handleCrash(interaction) {
    const bet = interaction.options.getInteger('bet');
    const target = interaction.options.getNumber('multiplier');
    const uid = interaction.user.id;
    const err = checkBet(interaction, bet);
    if (err) return interaction.reply({ content: err, ephemeral: true });
    if (target <= 1) return interaction.reply({ content: 'Multiplier must be above 1!', ephemeral: true });

    const crashPoint = 1 + Math.random() * 5;
    const won = crashPoint >= target;
    const payout = won ? Math.floor(bet * target) : 0;

    if (won) addBalance(uid, payout);
    else addBalance(uid, -bet);

    const profit = won ? payout : -bet;
    const big = won && profit >= 10000;
    const e = new EmbedBuilder().setColor(big ? 0xFFD700 : (won ? 0x00ff00 : 0xff0000))
        .setTitle(big ? '🎉💰🎉 CRASH WINNER! 🎉💰🎉' : '📈 Crash')
        .addFields(
            { name: '🚀 Crash Point', value: `${crashPoint.toFixed(2)}x`, inline: true },
            { name: '🎯 Your Target', value: `${target.toFixed(2)}x`, inline: true },
            { name: 'Outcome', value: won ? `Cashed out! Won **${profit.toLocaleString()}** coins!` : `Crashed! Lost **${bet.toLocaleString()}** coins...` },
            { name: 'Balance', value: `${getBalance(uid).toLocaleString()} coins` }
        );
    if (big) e.setFooter({ text: '🏆 LEGENDARY WIN 🏆' });
    await interaction.reply({ embeds: [e] });
}

// ===================== CHICKEN =====================

async function handleChicken(interaction) {
    const bet = interaction.options.getInteger('bet');
    const uid = interaction.user.id;
    const err = checkBet(interaction, bet);
    if (err) return interaction.reply({ content: err, ephemeral: true });
    if (chickenGames.has(uid)) return interaction.reply({ content: 'You already have a Chicken game!', ephemeral: true });

    addBalance(uid, -bet);
    const lanes = [];
    for (let i = 0; i < 5; i++) {
        lanes.push({ car: Math.floor(Math.random() * 5) });
    }
    chickenGames.set(uid, { lanes, bet, currentLane: 0, position: 2, uid });

    const e = new EmbedBuilder().setColor(0xf1c40f).setTitle('🐔 Cross the Road!').setDescription(`**Bet: ${bet.toLocaleString()} coins**\nCross 5 lanes! Dodge the cars 🚗\nLane ${1}/5 — Pick a row to cross to.`);
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('chicken_up').setLabel('⬆ Move Up').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('chicken_down').setLabel('⬇ Move Down').setStyle(ButtonStyle.Danger)
    );
    await interaction.reply({ embeds: [e], components: [row] });
}

async function handleChickenButton(interaction) {
    const uid = interaction.user.id;
    const g = chickenGames.get(uid);
    if (!g) return interaction.reply({ content: 'No active Chicken game!', ephemeral: true });

    if (interaction.customId === 'chicken_up') {
        if (g.position === 0) return interaction.reply({ content: "Can't move up further!", ephemeral: true });
        g.position--;
    } else {
        if (g.position === 4) return interaction.reply({ content: "Can't move down further!", ephemeral: true });
        g.position++;
    }

    const lane = g.lanes[g.currentLane];
    if (g.position === lane.car) {
        chickenGames.delete(uid);
        const e = new EmbedBuilder().setColor(0xff0000).setTitle('🐔 Splat!').setDescription(`**💥 Hit by a car! Lost ${g.bet.toLocaleString()} coins.**`).addFields({ name: 'Balance', value: `${getBalance(uid).toLocaleString()} coins` });
        return interaction.update({ embeds: [e], components: [] });
    }

    g.currentLane++;

    if (g.currentLane >= 5) {
        const payout = Math.floor(g.bet * 3);
        addBalance(uid, payout);
        const big = payout >= 10000;
        chickenGames.delete(uid);
        const e = new EmbedBuilder().setColor(big ? 0xFFD700 : 0x00ff00).setTitle(big ? '🎉💰🎉 CHICKEN WINNER! 🎉💰🎉' : '🐔 Safe!')
            .setDescription(`**Crossed all lanes! Won ${payout.toLocaleString()} coins (3x)!**`).addFields({ name: 'Balance', value: `${getBalance(uid).toLocaleString()} coins` });
        if (big) e.setFooter({ text: '🏆 LEGENDARY WIN 🏆' });
        return interaction.update({ embeds: [e], components: [] });
    }

    const laneDisp = '🚗'.padStart(g.lanes[g.currentLane].car * 2 + 1, '⬜') + '⬜'.repeat(4 - g.lanes[g.currentLane].car);
    const e = new EmbedBuilder().setColor(0xf1c40f).setTitle('🐔 Cross the Road!').setDescription(`**Lane ${g.currentLane + 1}/5**\n${laneDisp}\n🚶 Position: ${'   '.repeat(g.position)}🐔\nPick a row to cross to.`);
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('chicken_up').setLabel('⬆ Move Up').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('chicken_down').setLabel('⬇ Move Down').setStyle(ButtonStyle.Danger)
    );
    await interaction.update({ embeds: [e], components: [row] });
}

// ===================== PLINKO =====================

async function handlePlinko(interaction) {
    const bet = interaction.options.getInteger('bet');
    const uid = interaction.user.id;
    const err = checkBet(interaction, bet);
    if (err) return interaction.reply({ content: err, ephemeral: true });

    addBalance(uid, -bet);
    const slots = [0.5, 1, 1.5, 2, 3, 5, 3, 2, 1.5, 1, 0.5];
    let position = 5;
    for (let i = 0; i < 8; i++) {
        position += Math.random() < 0.5 ? -1 : 1;
        if (position < 0) position = 0;
        if (position >= slots.length) position = slots.length - 1;
    }
    const mult = slots[position];
    const payout = Math.floor(bet * mult);
    const won = payout > 0;

    if (won) addBalance(uid, payout);
    const profit = won ? payout : -bet;
    const big = won && profit >= 10000;

    const ballPos = '  '.repeat(position) + '🟠';
    const slotDisp = slots.map((s, i) => i === position ? `**${s}x**` : `${s}x`).join(' | ');

    const e = new EmbedBuilder().setColor(big ? 0xFFD700 : (won ? 0x00ff00 : 0xff0000))
        .setTitle(big ? '🎉💰🎉 PLINKO WINNER! 🎉💰🎉' : '🔵 Plinko')
        .setDescription(`**${ballPos}**\n${slotDisp}`)
        .addFields({ name: 'Multiplier', value: `${mult}x`, inline: true },
            { name: 'Outcome', value: won ? `Won **${profit.toLocaleString()}** coins!` : `Lost **${bet.toLocaleString()}** coins...` },
            { name: 'Balance', value: `${getBalance(uid).toLocaleString()} coins` });
    if (big) e.setFooter({ text: '🏆 LEGENDARY WIN 🏆' });
    await interaction.reply({ embeds: [e] });
}

// ===================== GUESS =====================

async function handleGuess(interaction) {
    const bet = interaction.options.getInteger('bet');
    const guess = interaction.options.getInteger('number');
    const uid = interaction.user.id;
    const err = checkBet(interaction, bet);
    if (err) return interaction.reply({ content: err, ephemeral: true });

    addBalance(uid, -bet);
    const secret = Math.floor(Math.random() * 20) + 1;
    const dist = Math.abs(guess - secret);

    let mult, resultText;
    if (dist === 0) {
        mult = 8;
        resultText = `🎯 **EXACT MATCH!** ${mult}x payout!`;
    } else if (dist <= 2) {
        mult = 5;
        resultText = `**So close!** ${dist} away — ${mult}x payout!`;
    } else if (dist <= 5) {
        mult = 3;
        resultText = `**Close!** ${dist} away — ${mult}x payout!`;
    } else {
        mult = -(dist / 5);
        resultText = `**Missed by ${dist}.** Lose ${Math.abs(mult).toFixed(1)}x bet.`;
    }

    if (mult > 0) {
        const payout = Math.floor(bet * mult);
        addBalance(uid, payout);
        const big = payout >= 10000;
        const e = new EmbedBuilder().setColor(big ? 0xFFD700 : 0x00ff00)
            .setTitle(big ? '🎉💰🎉 GUESS MASTER! 🎉💰🎉' : '🎲 Guess')
            .addFields({ name: 'Your Guess', value: `${guess}`, inline: true }, { name: 'Secret Number', value: `${secret}`, inline: true },
                { name: 'Result', value: resultText }, { name: 'Winnings', value: `+**${payout.toLocaleString()}** coins`, inline: true },
                { name: 'Balance', value: `${getBalance(uid).toLocaleString()} coins` });
        if (big) e.setFooter({ text: '🏆 LEGENDARY WIN 🏆' });
        return interaction.reply({ embeds: [e] });
    } else {
        const loss = Math.min(Math.floor(bet * Math.abs(mult)), getBalance(uid));
        addBalance(uid, -loss);
        if (loss === 0) addBalance(uid, -1);
        const e = new EmbedBuilder().setColor(0xff0000).setTitle('🎲 Guess')
            .addFields({ name: 'Your Guess', value: `${guess}`, inline: true }, { name: 'Secret Number', value: `${secret}`, inline: true },
                { name: 'Result', value: resultText }, { name: 'Lost', value: `-**${(loss || 1).toLocaleString()}** coins`, inline: true },
                { name: 'Balance', value: `${getBalance(uid).toLocaleString()} coins` });
        return interaction.reply({ embeds: [e] });
    }
}

client.login(TOKEN);
