const { Client, GatewayIntentBits, PermissionsBitField } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
require('dotenv').config();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.MessageContent
    ],
});

const GUILD_ID = '713135492262002716';
const CHANNEL_IDS = ['972240017898479616', '1325231273911914556'];
const WARNING_CHANNEL_ID = '1340579927942103072';
const ROLE_ID = '871166335017713726';
const DB_PATH = path.join(__dirname, 'users.db');

// Initialize SQLite database
const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
        console.error('Could not connect to database', err);
    } else {
        console.log('Connected to database');
        db.run(`CREATE TABLE IF NOT EXISTS users (
            user_id TEXT PRIMARY KEY,
            last_message TIMESTAMP,
            joined_at TIMESTAMP,
            last_warning TIMESTAMP
        )`, (err) => {
            if (err) {
                console.error('Failed to create users table:', err);
            } else {
                console.log('Users table is ready');
            }
        });
    }
});

client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}!`);

    try {
        const guild = await client.guilds.fetch(GUILD_ID);
        console.log(`Fetched guild: ${guild.name}`);

        // Fetch all members
        const members = await guild.members.fetch();
        console.log(`Fetched ${members.size} members`);

        // Fetch and log messages from the specified channels
        await fetchAndLogRecentMessages();

        let usersAddedCount = 0;

        // Add joined_at timestamp for users who don't have a message in the channels
        const addUserPromises = members.map(member => {
            if (member.user.bot) return Promise.resolve(); // Ignore bots

            return new Promise((resolve, reject) => {
                db.run(`INSERT OR IGNORE INTO users (user_id, last_message, joined_at, last_warning) VALUES (?, ?, ?, ?)`, [member.id, null, member.joinedAt.toISOString(), null], function(err) {
                    if (err) {
                        console.error(`Failed to add user ${member.id} to the database:`, err);
                        reject(err);
                    } else {
                        usersAddedCount++;
                        console.log(`Added user ${member.id} to db with joined_at: ${member.joinedAt.toISOString()}`);
                        if (usersAddedCount % 100 === 0) {
                            console.log(`${usersAddedCount} users added to db`);
                        }
                        resolve();
                    }
                });
            });
        });

        await Promise.all(addUserPromises);
        console.log(`${usersAddedCount} total users added to db`);

        // Check timestamps and manage roles and warnings
        checkTimestampsAndUpdateRoles();

        // Periodically clean up users who are no longer in the server
        setInterval(cleanupUsers, 3600000); // Run every hour

        console.log('Initialization complete');
    } catch (error) {
        console.error('Failed to fetch guild or members:', error);
    }
});

client.on('messageCreate', message => {
    if (message.author.bot) return; // Ignore bot messages

    if (CHANNEL_IDS.includes(message.channel.id)) {
        const now = new Date().toISOString();
        db.run(`INSERT OR REPLACE INTO users (user_id, last_message, joined_at, last_warning) VALUES (?, ?, COALESCE((SELECT joined_at FROM users WHERE user_id = ?), ?), COALESCE((SELECT last_warning FROM users WHERE user_id = ?), ?))`, [message.author.id, now, message.author.id, now, message.author.id, now], function(err) {
            if (err) {
                console.error(`Failed to update timestamp for user ${message.author.id}:`, err);
            } else {
                console.log(`Timestamp updated for user ${message.author.id}: ${now}`);
            }
        });
    }
});

client.on('guildMemberAdd', member => {
    if (member.user.bot) return; // Ignore bots

    const joinedAt = member.joinedAt.toISOString();
    db.run(`INSERT OR IGNORE INTO users (user_id, last_message, joined_at, last_warning) VALUES (?, ?, ?, ?)`, [member.id, joinedAt, joinedAt, null], function(err) {
        if (err) {
            console.error(`Failed to add new user ${member.id} to the database:`, err);
        } else {
            console.log(`New user ${member.id} added to db with joined_at: ${joinedAt}`);
        }
    });
});

async function fetchAndLogRecentMessages() {
    let latestTimestamps = {};
    let totalMessagesFetched = 0;
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 31);

    for (const channelId of CHANNEL_IDS) {
        try {
            const channel = await client.channels.fetch(channelId);
            console.log(`Fetching recent messages from channel ${channelId}`);

            if (!channel.permissionsFor(client.user).has(PermissionsBitField.Flags.ViewChannel)) {
                console.error(`Bot does not have permission to view channel ${channelId}`);
                continue;
            }

            if (!channel.permissionsFor(client.user).has(PermissionsBitField.Flags.ReadMessageHistory)) {
                console.error(`Bot does not have permission to read message history in channel ${channelId}`);
                continue;
            }

            let lastMessageId;
            let stopFetching = false;

            while (!stopFetching) {
                const options = { limit: 100 };
                if (lastMessageId) options.before = lastMessageId;

                const messages = await channel.messages.fetch(options);
                if (messages.size === 0) break;

                messages.forEach(message => {
                    if (message.createdAt < thirtyDaysAgo) {
                        stopFetching = true;
                        return;
                    }

                    if (message.author.bot) return; // Ignore bot messages

                    const timestamp = message.createdAt.toISOString();
                    if (!latestTimestamps[message.author.id] || new Date(timestamp) > new Date(latestTimestamps[message.author.id])) {
                        latestTimestamps[message.author.id] = timestamp;
                    }
                });

                totalMessagesFetched += messages.size;
                const oldestMessage = messages.reduce((oldest, msg) => msg.createdAt < oldest.createdAt ? msg : oldest, messages.first());
                console.log(`Fetched ${totalMessagesFetched} recent messages (oldest: ${oldestMessage.createdAt.toISOString()})`);

                lastMessageId = messages.last().id;
            }
        } catch (error) {
            console.error(`Failed to fetch recent messages from channel ${channelId}:`, error);
        }
    }

    // Batch update the database with the latest timestamps after fetching messages from all channels
    const updatePromises = Object.entries(latestTimestamps).map(([userId, timestamp]) => {
        return new Promise((resolve, reject) => {
            db.run(`INSERT OR REPLACE INTO users (user_id, last_message, joined_at, last_warning) VALUES (?, ?, COALESCE((SELECT joined_at FROM users WHERE user_id = ?), ?), COALESCE((SELECT last_warning FROM users WHERE user_id = ?), ?))`, [userId, timestamp, userId, timestamp, userId, timestamp], function(err) {
                if (err) {
                    console.error(`Failed to update timestamp for user ${userId} from message fetch:`, err);
                    reject(err);
                } else {
                    console.log(`Timestamp updated for user ${userId} from message fetch: ${timestamp}`);
                    resolve();
                }
            });
        });
    });

    await Promise.all(updatePromises);
    console.log('Completed fetching recent messages from all channels and updating timestamps');
}

async function checkTimestampsAndUpdateRoles() {
    const now = new Date();
    const fourteenDaysAgo = new Date(now.setDate(now.getDate() - 14)).toISOString();
    const thirtyDaysAgo = new Date(now.setDate(now.getDate() - 16)).toISOString(); // Reset to 30 days ago

    db.all(`SELECT user_id, last_message, last_warning FROM users WHERE last_message < ? OR last_message IS NULL`, [fourteenDaysAgo], async (err, rows) => {
        if (err) {
            console.error('Failed to query users with old timestamps:', err);
            return;
        }

        const guild = await client.guilds.fetch(GUILD_ID);
        console.log(`Checking roles for ${rows.length} users`);

        let warningChannel;
        try {
            warningChannel = await client.channels.fetch(WARNING_CHANNEL_ID);
        } catch (err) {
            console.error(`Failed to fetch warning channel: ${err.message}`);
            warningChannel = null;
        }

        const roleRemovalPromises = rows.map(row => {
            return new Promise(async (resolve, reject) => {
                const member = await guild.members.fetch(row.user_id).catch(() => null);
                if (member && !member.user.bot) {
                    if (!row.last_message || new Date(row.last_message) < new Date(thirtyDaysAgo)) {
                        if (member.roles.cache.has(ROLE_ID)) {
                            member.roles.remove(ROLE_ID).then(() => {
                                console.log(`Removed role from ${member.user.tag}`);
                                resolve();
                            }).catch(err => {
                                console.error(`Failed to remove role from ${member.user.tag}:`, err);
                                reject(err);
                            });
                        } else {
                            resolve();
                        }
                    } else if (new Date(row.last_message) < new Date(fourteenDaysAgo) && (!row.last_warning || new Date(row.last_warning) < new Date(fourteenDaysAgo)) && warningChannel) {
                        try {
                            await warningChannel.send(`<@${member.id}> This is a warning, you have not sent any message in past 14 days, failure to send a message will result in removal of access to the server`);
                            const now = new Date().toISOString();
                            db.run(`UPDATE users SET last_warning = ? WHERE user_id = ?`, [now, member.id], function(err) {
                                if (err) {
                                    console.error(`Failed to update last_warning for user ${member.id}:`, err);
                                } else {
                                    console.log(`Updated last_warning for user ${member.id}: ${now}`);
                                }
                            });
                            resolve();
                        } catch (err) {
                            console.error(`Failed to send warning to ${member.user.tag}: ${err.message}`);
                            resolve(); // Continue without rejecting to ensure role removal continues
                        }
                    } else {
                        resolve();
                    }
                } else {
                    resolve();
                }
            });
        });

        await Promise.all(roleRemovalPromises);
    });
}

async function cleanupUsers() {
    try {
        const guild = await client.guilds.fetch(GUILD_ID);
        const members = await guild.members.fetch();
        const memberIds = new Set(members.map(member => member.id));

        db.all(`SELECT user_id FROM users`, async (err, rows) => {
            if (err) {
                console.error('Failed to query users from database:', err);
                return;
            }

            const deletePromises = rows.map(row => {
                return new Promise((resolve, reject) => {
                    if (!memberIds.has(row.user_id)) {
                        db.run(`DELETE FROM users WHERE user_id = ?`, [row.user_id], function(err) {
                            if (err) {
                                console.error(`Failed to delete user ${row.user_id} from database:`, err);
                                reject(err);
                            } else {
                                console.log(`Deleted user ${row.user_id} from database`);
                                resolve();
                            }
                        });
                    } else {
                        resolve();
                    }
                });
            });

            await Promise.all(deletePromises);
        });
    } catch (error) {
        console.error('Failed to fetch guild or members:', error);
    }
}

client.login(process.env.DISCORD_BOT_TOKEN); // Use bot token from .env file