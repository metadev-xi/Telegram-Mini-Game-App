/**
 * Telegram Mini Game App - Game Manager
 * 
 * Core module for managing game sessions, user interactions,
 * and Telegram Bot API integration for the mini game platform.
 */

const { Telegraf } = require('telegraf');
const { Markup } = require('telegraf');
const admin = require('firebase-admin');
const axios = require('axios');
const crypto = require('crypto');

// Game types supported by the platform
const GAME_TYPES = {
  PUZZLE: 'puzzle',
  ARCADE: 'arcade',
  STRATEGY: 'strategy',
  TRIVIA: 'trivia',
  MULTIPLAYER: 'multiplayer'
};

class TelegramGameManager {
  /**
   * Initialize the game manager
   * @param {Object} config - Configuration options
   */
  constructor(config) {
    // Set up Telegram bot
    this.bot = new Telegraf(config.botToken);
    this.botUsername = config.botUsername;
    
    // Set up Firebase for data storage
    if (config.firebaseCredentials) {
      admin.initializeApp({
        credential: admin.credential.cert(config.firebaseCredentials)
      });
      this.db = admin.firestore();
      this.usersCollection = this.db.collection('users');
      this.gamesCollection = this.db.collection('games');
      this.scoresCollection = this.db.collection('scores');
    }
    
    // Game configuration
    this.games = config.games || {};
    this.defaultLanguage = config.defaultLanguage || 'en';
    this.webAppUrl = config.webAppUrl || 'https://telegram-mini-game.app';
    
    // Cache for active sessions
    this.activeSessions = new Map();
    this.userPreferences = new Map();
    
    // Initialize bot commands and handlers
    this.setupBotCommands();
  }

  /**
   * Set up bot commands and handlers
   */
  setupBotCommands() {
    // Command to start a new game session
    this.bot.command('newgame', async (ctx) => {
      try {
        await this.handleNewGameCommand(ctx);
      } catch (error) {
        console.error('Error handling newgame command:', error);
        await ctx.reply('Sorry, there was an error starting the game. Please try again later.');
      }
    });
    
    // Command to challenge a friend
    this.bot.command('challenge', async (ctx) => {
      try {
        await this.handleChallengeCommand(ctx);
      } catch (error) {
        console.error('Error handling challenge command:', error);
        await ctx.reply('Sorry, there was an error creating the challenge. Please try again later.');
      }
    });
    
    // Command to view leaderboard
    this.bot.command('leaderboard', async (ctx) => {
      try {
        await this.handleLeaderboardCommand(ctx);
      } catch (error) {
        console.error('Error handling leaderboard command:', error);
        await ctx.reply('Sorry, there was an error retrieving the leaderboard. Please try again later.');
      }
    });
    
    // Command to check daily quests
    this.bot.command('daily', async (ctx) => {
      try {
        await this.handleDailyQuestsCommand(ctx);
      } catch (error) {
        console.error('Error handling daily quests command:', error);
        await ctx.reply('Sorry, there was an error retrieving your daily quests. Please try again later.');
      }
    });
    
    // Command to view user profile
    this.bot.command('profile', async (ctx) => {
      try {
        await this.handleProfileCommand(ctx);
      } catch (error) {
        console.error('Error handling profile command:', error);
        await ctx.reply('Sorry, there was an error retrieving your profile. Please try again later.');
      }
    });
    
    // Command to get help
    this.bot.command('help', async (ctx) => {
      try {
        await this.handleHelpCommand(ctx);
      } catch (error) {
        console.error('Error handling help command:', error);
        await ctx.reply('Sorry, there was an error retrieving help information. Please try again later.');
      }
    });
    
    // Handle callback queries from inline buttons
    this.bot.on('callback_query', async (ctx) => {
      try {
        await this.handleCallbackQuery(ctx);
      } catch (error) {
        console.error('Error handling callback query:', error);
        await ctx.answerCbQuery('An error occurred. Please try again.');
      }
    });
    
    // Handle game score submissions
    this.bot.on('game_query', async (ctx) => {
      try {
        await this.handleGameQuery(ctx);
      } catch (error) {
        console.error('Error handling game query:', error);
      }
    });
    
    // Handle Web App data
    this.bot.on('web_app_data', async (ctx) => {
      try {
        await this.handleWebAppData(ctx);
      } catch (error) {
        console.error('Error handling web app data:', error);
        await ctx.reply('Sorry, there was an error processing your game data. Please try again later.');
      }
    });
    
    // Handle message with inline queries
    this.bot.on('inline_query', async (ctx) => {
      try {
        await this.handleInlineQuery(ctx);
      } catch (error) {
        console.error('Error handling inline query:', error);
      }
    });
    
    // Handle new users
    this.bot.on('new_chat_members', async (ctx) => {
      try {
        await this.handleNewMembers(ctx);
      } catch (error) {
        console.error('Error handling new members:', error);
      }
    });
  }

  /**
   * Handle new game command
   * @param {Object} ctx - Telegram context
   */
  async handleNewGameCommand(ctx) {
    const userId = ctx.from.id;
    const chatId = ctx.chat.id;
    
    // Check if user exists in database, register if not
    await this.ensureUserRegistered(userId, ctx.from);
    
    // Generate game options keyboard
    const gameOptions = [];
    
    // Group games by type
    const gamesByType = {};
    Object.entries(this.games).forEach(([gameId, game]) => {
      if (!gamesByType[game.type]) {
        gamesByType[game.type] = [];
      }
      gamesByType[game.type].push({ id: gameId, ...game });
    });
    
    // Create buttons for each game type
    Object.entries(gamesByType).forEach(([type, games]) => {
      const row = games.slice(0, 3).map(game => 
        Markup.button.callback(game.name, `game:${game.id}`)
      );
      gameOptions.push(row);
    });
    
    // Add a "More Games" button if needed
    gameOptions.push([Markup.button.webApp('More Games', `${this.webAppUrl}/games`)]);
    
    await ctx.reply('Choose a game to play:', Markup.inlineKeyboard(gameOptions));
    
    // Track analytics for command usage
    this.trackUserAction(userId, 'command_used', { command: 'newgame' });
  }

  /**
   * Handle challenge command
   * @param {Object} ctx - Telegram context
   */
  async handleChallengeCommand(ctx) {
    const userId = ctx.from.id;
    
    // Parse command arguments to see if a game was specified
    const args = ctx.message.text.split(' ').slice(1);
    const specifiedGame = args.join(' ').trim();
    
    // Get list of games for challenge
    let gamesList;
    if (specifiedGame) {
      // Find games matching the specified name
      gamesList = Object.entries(this.games)
        .filter(([_, game]) => game.name.toLowerCase().includes(specifiedGame.toLowerCase()))
        .map(([id, game]) => ({ id, ...game }));
      
      if (gamesList.length === 0) {
        await ctx.reply(`No games found matching "${specifiedGame}". Please try another game name.`);
        return;
      }
    } else {
      // Show popular multiplayer games
      gamesList = Object.entries(this.games)
        .filter(([_, game]) => game.type === GAME_TYPES.MULTIPLAYER)
        .map(([id, game]) => ({ id, ...game }))
        .slice(0, 5);  // Limit to top 5
    }
    
    // Create a challenge link for each game
    const challengeOptions = gamesList.map(game => {
      const challengeId = this.generateChallengeId(userId, game.id);
      const challengeUrl = `https://t.me/${this.botUsername}?start=challenge_${challengeId}`;
      
      return [Markup.button.url(`Challenge: ${game.name}`, challengeUrl)];
    });
    
    // Add button to create custom challenge
    challengeOptions.push([
      Markup.button.webApp('Create Custom Challenge', `${this.webAppUrl}/challenge/create`)
    ]);
    
    await ctx.reply(
      'Choose a game to challenge your friends:',
      Markup.inlineKeyboard(challengeOptions)
    );
    
    // Track analytics
    this.trackUserAction(userId, 'command_used', { command: 'challenge' });
  }

  /**
   * Handle leaderboard command
   * @param {Object} ctx - Telegram context
   */
  async handleLeaderboardCommand(ctx) {
    const userId = ctx.from.id;
    const chatId = ctx.chat.id;
    
    // Check if this is a group chat
    const isGroup = ctx.chat.type === 'group' || ctx.chat.type === 'supergroup';
    
    // Parse command arguments to see if a game was specified
    const args = ctx.message.text.split(' ').slice(1);
    const specifiedGame = args.join(' ').trim();
    
    let leaderboardText = '';
    let gameId = null;
    
    if (specifiedGame) {
      // Find game matching the specified name
      const gameEntry = Object.entries(this.games)
        .find(([_, game]) => game.name.toLowerCase() === specifiedGame.toLowerCase());
      
      if (!gameEntry) {
        await ctx.reply(`No game found matching "${specifiedGame}". Please check the game name and try again.`);
        return;
      }
      
      gameId = gameEntry[0];
      leaderboardText = `🏆 Leaderboard for ${gameEntry[1].name}:\n\n`;
    } else {
      leaderboardText = '🏆 Global Leaderboard:\n\n';
    }
    
    // Fetch leaderboard data
    const leaderboard = await this.getLeaderboard({
      gameId,
      chatId: isGroup ? chatId : null,
      limit: 10
    });
    
    if (leaderboard.length === 0) {
      await ctx.reply('No scores recorded yet. Be the first to play!');
      return;
    }
    
    // Format leaderboard text
    leaderboard.forEach((entry, index) => {
      const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
      leaderboardText += `${medal} ${entry.username}: ${entry.score} points\n`;
    });
    
    // Add button to view full leaderboard
    const leaderboardButtons = [
      [Markup.button.webApp('View Full Leaderboard', `${this.webAppUrl}/leaderboard${gameId ? `?game=${gameId}` : ''}`)],
      [Markup.button.callback('My Ranking', `myrank${gameId ? `:${gameId}` : ''}`)]
    ];
    
    await ctx.reply(leaderboardText, Markup.inlineKeyboard(leaderboardButtons));
    
    // Track analytics
    this.trackUserAction(userId, 'command_used', { command: 'leaderboard', gameId });
  }

  /**
   * Handle daily quests command
   * @param {Object} ctx - Telegram context
   */
  async handleDailyQuestsCommand(ctx) {
    const userId = ctx.from.id;
    
    // Fetch user's daily quests
    const quests = await this.getUserDailyQuests(userId);
    
    if (!quests || quests.length === 0) {
      await ctx.reply('You don\'t have any active daily quests yet. Start playing games to receive quests!');
      return;
    }
    
    // Format quests text
    let questsText = '📋 Your Daily Quests:\n\n';
    
    quests.forEach((quest, index) => {
      const progress = quest.completed ? '✅' : `${quest.progress}/${quest.target}`;
      const reward = quest.reward ? ` - Reward: ${quest.reward}` : '';
      questsText += `${index + 1}. ${quest.description} [${progress}]${reward}\n`;
    });
    
    // Add total rewards text
    const totalRewards = quests
      .filter(quest => quest.completed)
      .reduce((sum, quest) => sum + parseInt(quest.reward || '0'), 0);
    
    if (totalRewards > 0) {
      questsText += `\nTotal rewards ready to claim: ${totalRewards} coins`;
    }
    
    // Add buttons for quest actions
    const questButtons = [];
    const anyCompletedUnclaimed = quests.some(q => q.completed && !q.claimed);
    
    if (anyCompletedUnclaimed) {
      questButtons.push([Markup.button.callback('Claim Rewards', 'claim_rewards')]);
    }
    
    questButtons.push([Markup.button.webApp('Quest Details', `${this.webAppUrl}/quests`)]);
    
    await ctx.reply(questsText, Markup.inlineKeyboard(questButtons));
    
    // Track analytics
    this.trackUserAction(userId, 'command_used', { command: 'daily' });
  }

  /**
   * Handle profile command
   * @param {Object} ctx - Telegram context
   */
  async handleProfileCommand(ctx) {
    const userId = ctx.from.id;
    
    // Fetch user profile data
    const userProfile = await this.getUserProfile(userId);
    
    if (!userProfile) {
      await ctx.reply('Profile not found. Please start a game first to create your profile.');
      return;
    }
    
    // Format profile text
    let profileText = `👤 *${userProfile.username}'s Profile*\n\n`;
    profileText += `🏆 Total Score: ${userProfile.totalScore}\n`;
    profileText += `🎮 Games Played: ${userProfile.gamesPlayed}\n`;
    profileText += `🥇 Victories: ${userProfile.victories}\n`;
    profileText += `💰 Coins: ${userProfile.coins}\n`;
    profileText += `🎖 Achievements: ${userProfile.achievements.length}/${userProfile.totalAchievements}\n`;
    
    if (userProfile.currentStreak > 0) {
      profileText += `🔥 Daily Streak: ${userProfile.currentStreak} days\n`;
    }
    
    // Add buttons for profile actions
    const profileButtons = [
      [Markup.button.webApp('Full Profile', `${this.webAppUrl}/profile`)],
      [Markup.button.webApp('Achievements', `${this.webAppUrl}/achievements`)]
    ];
    
    // Send profile with markdown formatting
    await ctx.replyWithMarkdown(profileText, Markup.inlineKeyboard(profileButtons));
    
    // Track analytics
    this.trackUserAction(userId, 'command_used', { command: 'profile' });
  }

  /**
   * Handle help command
   * @param {Object} ctx - Telegram context
   */
  async handleHelpCommand(ctx) {
    const helpText = `
*Telegram Mini Game - Help*

Here are the available commands:

/newgame - Start a new game session
/challenge - Challenge a friend
/leaderboard - View global rankings
/daily - Check your daily quests
/profile - View your gaming profile
/help - Show this help message

*How to Play:*
1. Use /newgame to select a game
2. Play the game in Telegram
3. Your scores will be automatically recorded
4. Challenge friends with /challenge
5. Complete daily quests for rewards

*Need More Help?*
Tap the button below to visit our support channel
    `;
    
    const helpButtons = [
      [Markup.button.url('Support Channel', 'https://t.me/MiniGameSupport')],
      [Markup.button.webApp('Game Tutorials', `${this.webAppUrl}/tutorials`)]
    ];
    
    await ctx.replyWithMarkdown(helpText, Markup.inlineKeyboard(helpButtons));
    
    // Track analytics
    this.trackUserAction(ctx.from.id, 'command_used', { command: 'help' });
  }

  /**
   * Handle callback query from inline buttons
   * @param {Object} ctx - Telegram context
   */
  async handleCallbackQuery(ctx) {
    const callbackData = ctx.callbackQuery.data;
    const userId = ctx.from.id;
    
    // Parse callback data
    if (callbackData.startsWith('game:')) {
      // Handle game selection
      const gameId = callbackData.split(':')[1];
      await this.startGame(ctx, gameId);
    } else if (callbackData.startsWith('myrank')) {
      // Handle "My Ranking" button
      const gameId = callbackData.includes(':') ? callbackData.split(':')[1] : null;
      await this.showUserRanking(ctx, userId, gameId);
    } else if (callbackData === 'claim_rewards') {
      // Handle reward claiming
      await this.claimQuestRewards(ctx, userId);
    } else {
      // Handle other callback queries
      await ctx.answerCbQuery('Action not recognized');
    }
    
    // Track analytics
    this.trackUserAction(userId, 'button_clicked', { callbackData });
  }

  /**
   * Start a game for a user
   * @param {Object} ctx - Telegram context
   * @param {string} gameId - ID of the game to start
   */
  async startGame(ctx, gameId) {
    const userId = ctx.from.id;
    const chatId = ctx.callbackQuery.message.chat.id;
    
    // Check if the game exists
    if (!this.games[gameId]) {
      await ctx.answerCbQuery('Game not found');
      return;
    }
    
    const game = this.games[gameId];
    
    // Create a new game session
    const sessionId = this.generateSessionId(userId, gameId);
    
    // Set up webapp URL with parameters
    const gameUrl = `${this.webAppUrl}/play?game=${gameId}&session=${sessionId}`;
    
    // Create button to open the game
    const gameButtons = Markup.inlineKeyboard([
      [Markup.button.webApp('Play Now', gameUrl)],
      [Markup.button.callback('How to Play', `howtoplay:${gameId}`)]
    ]);
    
    // Store session info
    this.activeSessions.set(sessionId, {
      userId,
      gameId,
      chatId,
      startTime: Date.now(),
      score: 0,
      completed: false
    });
    
    // Send game invitation message
    await ctx.editMessageText(
      `🎮 *${game.name}*\n\n${game.description}\n\nTap the button below to start playing!`,
      { parse_mode: 'Markdown', ...gameButtons }
    );
    
    // Track game start
    this.trackUserAction(userId, 'game_started', { gameId });
  }

  /**
   * Show user's ranking
   * @param {Object} ctx - Telegram context
   * @param {number} userId - User ID
   * @param {string} gameId - Game ID (optional)
   */
  async showUserRanking(ctx, userId, gameId) {
    // Get user's ranking
    const ranking = await this.getUserRanking(userId, gameId);
    
    if (!ranking) {
      await ctx.answerCbQuery('You haven\'t played any games yet!', { show_alert: true });
      return;
    }
    
    let rankingText = '';
    
    if (gameId && this.games[gameId]) {
      rankingText = `Your ranking in ${this.games[gameId].name}: ${ranking.position} out of ${ranking.totalPlayers} players\nYour best score: ${ranking.score}`;
    } else {
      rankingText = `Your global ranking: ${ranking.position} out of ${ranking.totalPlayers} players\nYour total score: ${ranking.score}`;
    }
    
    await ctx.answerCbQuery(rankingText, { show_alert: true });
  }

  /**
   * Claim quest rewards for a user
   * @param {Object} ctx - Telegram context
   * @param {number} userId - User ID
   */
  async claimQuestRewards(ctx, userId) {
    // Get completed quests
    const quests = await this.getUserDailyQuests(userId);
    const completedUnclaimed = quests.filter(q => q.completed && !q.claimed);
    
    if (completedUnclaimed.length === 0) {
      await ctx.answerCbQuery('No rewards to claim', { show_alert: true });
      return;
    }
    
    // Calculate total rewards
    const totalRewards = completedUnclaimed.reduce(
      (sum, quest) => sum + parseInt(quest.reward || '0'), 0
    );
    
    // Update user's coins and mark quests as claimed
    await this.updateUserCoins(userId, totalRewards);
    await this.markQuestsAsClaimed(userId, completedUnclaimed.map(q => q.id));
    
    // Update the quests message
    await this.handleDailyQuestsCommand(ctx);
    
    await ctx.answerCbQuery(`You've claimed ${totalRewards} coins!`, { show_alert: true });
    
    // Track analytics
    this.trackUserAction(userId, 'rewards_claimed', { amount: totalRewards });
  }

  /**
   * Handle game query
   * @param {Object} ctx - Telegram context
   */
  async handleGameQuery(ctx) {
    // Implementation for handling game queries
    // This would handle the Telegram game platform's queries
    await ctx.answerGameQuery(`${this.webAppUrl}/play`);
  }

  /**
   * Handle Web App data
   * @param {Object} ctx - Telegram context
   */
  async handleWebAppData(ctx) {
    const userId = ctx.from.id;
    const data = ctx.webAppData.data;
    
    try {
      // Parse the data from the Web App
      const parsedData = JSON.parse(data);
      
      if (parsedData.type === 'game_completed') {
        // Handle game completion
        await this.handleGameCompletion(ctx, userId, parsedData);
      } else if (parsedData.type === 'challenge_created') {
        // Handle challenge creation
        await this.handleChallengeCreation(ctx, userId, parsedData);
      } else if (parsedData.type === 'settings_update') {
        // Handle settings update
        await this.handleSettingsUpdate(ctx, userId, parsedData);
      }
    } catch (error) {
      console.error('Error parsing Web App data:', error);
      await ctx.reply('There was an error processing your game data. Please try again.');
    }
  }

  /**
   * Handle game completion data from Web App
   * @param {Object} ctx - Telegram context
   * @param {number} userId - User ID
   * @param {Object} data - Game completion data
   */
  async handleGameCompletion(ctx, userId, data) {
    const { sessionId, score, gameStats } = data;
    
    // Validate the session
    if (!this.activeSessions.has(sessionId)) {
      await ctx.reply('Game session expired or invalid. Please start a new game.');
      return;
    }
    
    const session = this.activeSessions.get(sessionId);
    
    if (session.userId !== userId) {
      await ctx.reply('Invalid session owner. Please start your own game.');
      return;
    }
    
    // Update session data
    session.score = score;
    session.completed = true;
    session.endTime = Date.now();
    session.gameStats = gameStats;
    
    // Save the score to the database
    await this.saveGameScore(userId, session.gameId, score, gameStats);
    
    // Check for quest progress
    await this.updateQuestProgress(userId, {
      gameId: session.gameId,
      score,
      gameStats
    });
    
    // Get game details
    const game = this.games[session.gameId];
    
    // Check if score is a personal best
    const isPersonalBest = await this.isPersonalBest(userId, session.gameId, score);
    
    // Prepare result message
    let resultMessage = `🎮 *${game.name} - Game Completed!*\n\n`;
    resultMessage += `Your score: *${score}* points\n`;
    
    if (isPersonalBest) {
      resultMessage += '🎉 New personal best!\n';
    }
    
    // Add any achievement unlocked
    const unlockedAchievements = await this.checkForUnlockedAchievements(userId, session.gameId, score, gameStats);
    
    if (unlockedAchievements.length > 0) {
      resultMessage += '\n🏆 *Achievements Unlocked:*\n';
      unlockedAchievements.forEach(achievement => {
        resultMessage += `- ${achievement.name}: ${achievement.description}\n`;
      });
    }
    
    // Add quest progress
    const questsUpdated = await this.getUpdatedQuests(userId);
    
    if (questsUpdated.length > 0) {
      resultMessage += '\n📋 *Quest Progress:*\n';
      questsUpdated.forEach(quest => {
        resultMessage += `- ${quest.description}: ${quest.progress}/${quest.target}\n`;
      });
    }
    
    // Buttons for result message
    const resultButtons = Markup.inlineKeyboard([
      [Markup.button.callback('Play Again', `game:${session.gameId}`)],
      [Markup.button.callback('View Leaderboard', `leaderboard:${session.gameId}`)]
    ]);
    
    // Send result message
    await ctx.replyWithMarkdown(resultMessage, resultButtons);
    
    // Clear session after processing
    setTimeout(() => {
      this.activeSessions.delete(sessionId);
    }, 60000); // Keep session for 1 minute for potential retries
    
    // Track analytics
    this.trackUserAction(userId, 'game_completed', {
      gameId: session.gameId,
      score,
      duration: session.endTime - session.startTime
    });
  }

  /**
   * Handle inline query for sharing games
   * @param {Object} ctx - Telegram context
   */
  async handleInlineQuery(ctx) {
    const query = ctx.inlineQuery.query.toLowerCase();
    const userId = ctx.from.id;
    
    // Filter games based on query
    const filteredGames = Object.entries(this.games)
      .filter(([_, game]) => 
        !query || 
        game.name.toLowerCase().includes(query) || 
        game.tags.some(tag => tag.toLowerCase().includes(query))
      )
      .map(([id, game]) => ({
        id,
        ...game
      }))
      .slice(0, 50); // Limit to 50 results
    
    // Create inline query results
    const results = filteredGames.map(game => ({
      type: 'game',
      id: game.id,
      game_short_name: game.shortName,
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback('Play Now', `game:${game.id}`)]
      ])
    }));
    
    // Answer inline query
    await ctx.answerInlineQuery(results, {
      cache_time: 300,
      is_personal: true
    });
    
    // Track analytics
    this.trackUserAction(userId, 'inline_query', { query });
  }

  /**
   * Handle new members in chat
   * @param {Object} ctx - Telegram context
   */
  async handleNewMembers(ctx) {
    const newMembers = ctx.message.new_chat_members;
    
    // Check if our bot is among the new members
    const botJoined = newMembers.some(member => member.id === ctx.botInfo.id);
    
    if (botJoined) {
      // Bot was added to a group
      const chatId = ctx.chat.id;
      const chatTitle = ctx.chat.title;
      
      // Save group info
      await this.saveGroupInfo(chatId, chatTitle);
      
      // Send welcome message
      const welcomeMessage = `
Thanks for adding me to ${chatTitle}!

I'm a Mini Game Bot that lets you play fun games directly in Telegram.

*Group Commands:*
/newgame - Start a new game
/challenge - Challenge group members
/leaderboard - View group rankings

Get started by using /newgame command!
      `;
      
      const welcomeButtons = Markup.inlineKeyboard([
        [Markup.button.callback('Start Playing', 'game_menu')]
      ]);
      
      await ctx.replyWithMarkdown(welcomeMessage, welcomeButtons);
      
      // Track analytics
      this.trackEvent('bot_added_to_group', {
        chatId,
        chatTitle,
        memberCount: ctx.chat.members_count
      });
    }
  }

  /**
   * Generate a unique session ID
   * @param {number} userId - User ID
   * @param {string} gameId - Game ID
   * @returns {string} Unique session ID
   */
  generateSessionId(userId, gameId) {
    const timestamp = Date.now();
    const randomString = Math.random().toString(36).substring(2, 8);
    return `${userId}_${gameId}_${timestamp}_${randomString}`;
  }

  /**
   * Generate a challenge ID
   * @param {number} userId - User ID
   * @param {string} gameId - Game ID
   * @returns {string} Challenge ID
   */
  generateChallengeId(userId, gameId) {
    const timestamp = Date.now();
    const randomString = Math.random().toString(36).substring(2, 6);
    return `${userId}_${gameId}_${timestamp}_${randomString}`;
  }

  /**
   * Ensure user is registered in the database
   * @param {number} userId - User ID
   * @param {Object} userData - User data from Telegram
   */
  async ensureUserRegistered(userId, userData) {
