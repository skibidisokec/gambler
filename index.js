const { Client, GatewayIntentBits, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, SlashCommandBuilder, REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'data.json');
const STARTING_BALANCE = 1000;
const TOKEN = process.env.TOKEN;

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
    if (!data.balances[userId]) {
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

const games = new Map();
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

const client = new Client({
    intents: [GatewayIntentBits.Guilds]
});

client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}!`);

    checkDailyReset();
    setInterval(checkDailyReset, 30000);

    const commands = [
        new SlashCommandBuilder()
            .setName('balance')
            .setDescription('Check your coin balance'),
        new SlashCommandBuilder()
            .setName('coinflip')
            .setDescription('Flip a coin to gamble')
            .addStringOption(option =>
                option.setName('choice')
                    .setDescription('Heads or Tails')
                    .setRequired(true)
                    .addChoices(
                        { name: 'Heads', value: 'heads' },
                        { name: 'Tails', value: 'tails' }
                    ))
            .addIntegerOption(option =>
                option.setName('amount')
                    .setDescription('Amount to bet')
                    .setRequired(true)),
        new SlashCommandBuilder()
            .setName('blackjack')
            .setDescription('Play a game of Blackjack')
            .addIntegerOption(option =>
                option.setName('bet')
                    .setDescription('Amount to bet')
                    .setRequired(true))
    ].map(cmd => cmd.toJSON());

    try {
        const rest = new REST({ version: '10' }).setToken(TOKEN);
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log('Slash commands registered!');
    } catch (error) {
        console.error('Error registering commands:', error);
    }
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) {
        if (interaction.isButton()) {
            return handleBlackjackButton(interaction);
        }
        return;
    }

    const { commandName } = interaction;

    switch (commandName) {
        case 'balance':
            await handleBalance(interaction);
            break;
        case 'coinflip':
            await handleCoinflip(interaction);
            break;
        case 'blackjack':
            await handleBlackjack(interaction);
            break;
    }
});

async function handleBalance(interaction) {
    const balance = getBalance(interaction.user.id);
    const timeLeft = nextResetTime ? msToTime(nextResetTime - Date.now()) : 'N/A';
    const embed = new EmbedBuilder()
        .setColor(0x00ff00)
        .setTitle('Balance')
        .setDescription(`**${interaction.user.username}**, you have **${balance.toLocaleString()}** coins.`)
        .setFooter({ text: `Reset in: ${timeLeft}` })
        .setTimestamp();
    await interaction.reply({ embeds: [embed] });
}

async function handleCoinflip(interaction) {
    const choice = interaction.options.getString('choice');
    const amount = interaction.options.getInteger('amount');
    const userId = interaction.user.id;
    const balance = getBalance(userId);

    if (amount <= 0) {
        return interaction.reply({ content: 'You must bet a positive amount!', ephemeral: true });
    }

    if (amount > balance) {
        return interaction.reply({ content: `You don't have enough coins! You have **${balance.toLocaleString()}** coins.`, ephemeral: true });
    }

    const result = Math.random() < 0.5 ? 'heads' : 'tails';
    const won = choice === result;

    if (won) {
        addBalance(userId, amount);
    } else {
        addBalance(userId, -amount);
    }

    const embed = new EmbedBuilder()
        .setColor(won ? 0x00ff00 : 0xff0000)
        .setTitle('Coin Flip')
        .addFields(
            { name: 'Your Choice', value: choice.charAt(0).toUpperCase() + choice.slice(1), inline: true },
            { name: 'Result', value: result.charAt(0).toUpperCase() + result.slice(1), inline: true },
            { name: 'Outcome', value: won ? `Won **${amount.toLocaleString()}** coins!` : `Lost **${amount.toLocaleString()}** coins...` },
            { name: 'New Balance', value: `${getBalance(userId).toLocaleString()} coins` }
        );

    await interaction.reply({ embeds: [embed] });
}

async function handleBlackjack(interaction) {
    const bet = interaction.options.getInteger('bet');
    const userId = interaction.user.id;
    const balance = getBalance(userId);

    if (bet <= 0) {
        return interaction.reply({ content: 'You must bet a positive amount!', ephemeral: true });
    }

    if (bet > balance) {
        return interaction.reply({ content: `You don't have enough coins! You have **${balance.toLocaleString()}** coins.`, ephemeral: true });
    }

    if (games.has(userId)) {
        return interaction.reply({ content: 'You already have an active blackjack game! Finish it first.', ephemeral: true });
    }

    const deck = createDeck();
    const playerHand = [deck.pop(), deck.pop()];
    const dealerHand = [deck.pop(), deck.pop()];

    const playerValue = handValue(playerHand);
    const dealerValue = handValue(dealerHand);

    if (playerValue === 21) {
        addBalance(userId, Math.floor(bet * 1.5));
        const embed = new EmbedBuilder()
            .setColor(0x00ff00)
            .setTitle('Blackjack!')
            .setDescription('**Natural Blackjack! You win!**')
            .addFields(
                { name: `Your Hand (${playerValue})`, value: handDisplay(playerHand), inline: true },
                { name: `Dealer Hand (${dealerValue})`, value: handDisplay(dealerHand), inline: true },
                { name: 'Payout', value: `+${Math.floor(bet * 1.5).toLocaleString()} coins` },
                { name: 'New Balance', value: `${getBalance(userId).toLocaleString()} coins` }
            );
        return interaction.reply({ embeds: [embed] });
    }

    addBalance(userId, -bet);

    const gameState = { deck, playerHand, dealerHand, bet, userId };
    games.set(userId, gameState);

    const embed = new EmbedBuilder()
        .setColor(0x3498db)
        .setTitle('Blackjack')
        .setDescription(`**Bet: ${bet.toLocaleString()} coins**`)
        .addFields(
            { name: `Your Hand (${playerValue})`, value: handDisplay(playerHand) },
            { name: `Dealer Hand (${handValue([dealerHand[0]])})`, value: `${cardDisplay(dealerHand[0])} ?` }
        );

    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('hit')
                .setLabel('Hit')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('stand')
                .setLabel('Stand')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId('double')
                .setLabel('Double Down')
                .setStyle(ButtonStyle.Danger)
        );

    await interaction.reply({ embeds: [embed], components: [row] });
}

async function handleBlackjackButton(interaction) {
    const userId = interaction.user.id;
    const game = games.get(userId);

    if (!game) {
        return interaction.reply({ content: "You don't have an active game!", ephemeral: true });
    }

    if (interaction.customId === 'hit') {
        game.playerHand.push(game.deck.pop());
        const value = handValue(game.playerHand);

        if (value > 21) {
            games.delete(userId);
            const embed = new EmbedBuilder()
                .setColor(0xff0000)
                .setTitle('Blackjack - Bust!')
                .setDescription(`**You busted! Lost ${game.bet.toLocaleString()} coins.**`)
                .addFields(
                    { name: 'Your Hand', value: handDisplay(game.playerHand) },
                    { name: 'Value', value: `${value}` },
                    { name: 'New Balance', value: `${getBalance(userId).toLocaleString()} coins` }
                );
            return interaction.update({ embeds: [embed], components: [] });
        }

        if (value === 21) {
            return finishBlackjack(interaction, game);
        }

        const embed = new EmbedBuilder()
            .setColor(0x3498db)
            .setTitle('Blackjack')
            .setDescription(`**Bet: ${game.bet.toLocaleString()} coins**`)
            .addFields(
                { name: `Your Hand (${value})`, value: handDisplay(game.playerHand) },
                { name: `Dealer Hand (${handValue([game.dealerHand[0]])})`, value: `${cardDisplay(game.dealerHand[0])} ?` }
            );

        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('hit')
                    .setLabel('Hit')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId('stand')
                    .setLabel('Stand')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId('double')
                    .setLabel('Double Down')
                    .setStyle(ButtonStyle.Danger)
            );

        return interaction.update({ embeds: [embed], components: [row] });
    }

    if (interaction.customId === 'stand') {
        return finishBlackjack(interaction, game);
    }

    if (interaction.customId === 'double') {
        const balance = getBalance(userId);
        if (balance < game.bet) {
            return interaction.reply({ content: `You don't have enough coins to double down!`, ephemeral: true });
        }
        addBalance(userId, -game.bet);
        game.bet *= 2;
        game.playerHand.push(game.deck.pop());
        const value = handValue(game.playerHand);

        if (value > 21) {
            games.delete(userId);
            const embed = new EmbedBuilder()
                .setColor(0xff0000)
                .setTitle('Blackjack - Bust!')
                .setDescription(`**You busted! Lost ${game.bet.toLocaleString()} coins.**`)
                .addFields(
                    { name: 'Your Hand', value: handDisplay(game.playerHand) },
                    { name: 'Value', value: `${value}` },
                    { name: 'New Balance', value: `${getBalance(userId).toLocaleString()} coins` }
                );
            return interaction.update({ embeds: [embed], components: [] });
        }

        return finishBlackjack(interaction, game);
    }
}

async function finishBlackjack(interaction, game) {
    const userId = interaction.user.id;
    games.delete(userId);

    while (handValue(game.dealerHand) < 17) {
        game.dealerHand.push(game.deck.pop());
    }

    const playerValue = handValue(game.playerHand);
    const dealerValue = handValue(game.dealerHand);

    let result, color;

    if (dealerValue > 21) {
        addBalance(userId, game.bet * 2);
        result = `**Dealer busted! You won ${game.bet.toLocaleString()} coins!**`;
        color = 0x00ff00;
    } else if (playerValue > dealerValue) {
        addBalance(userId, game.bet * 2);
        result = `**You win! +${game.bet.toLocaleString()} coins!**`;
        color = 0x00ff00;
    } else if (playerValue === dealerValue) {
        addBalance(userId, game.bet);
        result = `**Push! Your bet of ${game.bet.toLocaleString()} coins returned.**`;
        color = 0xffff00;
    } else {
        result = `**You lost ${game.bet.toLocaleString()} coins...**`;
        color = 0xff0000;
    }

    const embed = new EmbedBuilder()
        .setColor(color)
        .setTitle('Blackjack')
        .addFields(
            { name: `Your Hand (${playerValue})`, value: handDisplay(game.playerHand) },
            { name: `Dealer Hand (${dealerValue})`, value: handDisplay(game.dealerHand) },
            { name: 'Result', value: result },
            { name: 'New Balance', value: `${getBalance(userId).toLocaleString()} coins` }
        );

    await interaction.update({ embeds: [embed], components: [] });
}

client.login(TOKEN);
