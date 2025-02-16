# Discord Activity Bot

## Overview

The Discord Activity Bot is designed to help manage user activity within a Discord server. It performs several key tasks to ensure that user activity is tracked and roles are managed based on user interaction. The bot uses SQLite for persistent storage of user data.

## TL;DR
1. When bot starts, it fetches all the messages in specified channels going back 31 days or the specified time period.
2. After fetching messages in all channels, it updates `users.db` with all user IDs and the timestamp of their most recent message.
3. For users who have no messages in specified channels, it will use the date/time of when they joined the server for their timestamp.
4. For users who haven't sent any messages within 14 days after their timestamp, it sends a warning message in the specified channel pinging the user & informing them they have not been inactive within the last 14 days. (Doesn't send this message more than once every 14 days to a user.)
5. When users have not sent a message in any specified channels for 30 days after their timestamp, they have the specified role removed.
6. If bot doesn't have permissions to view or send messages in the specified warning/inactivity channel, it will skip sending warning message & move onto role removal from inactive users.

## Features

1. **Track User Activity**: 
   - The bot logs when users send messages in specified channels.
   - It updates the timestamp of the user's last message in the database.
   - Upon start, it fetches all messages in specified channels going back 31 days. Uses time/date of user's most recent message to use as their timestamp in database.

2. **Role Management**:
   - The bot removes a specified role from users who have been inactive for more than 30 days after their timestamp.
   - Sends a warning message to users who haven't sent a message within 14 days after their timestamp.

3. **Database Cleanup**:
   - The bot periodically checks for users who are no longer in the server and removes their records from the database.

## How It Works

### Initialization

- When the bot starts, it connects to the specified SQLite database and ensures that the `users` table exists.
- The bot fetches all members of the specified guild and initializes their last message timestamps in the database.
- The bot ignores bot users when performing these operations.

### Message Tracking

- The bot listens for new messages in specified channels.
- When a message is sent, the bot updates the user's last message timestamp in the database.
- The bot ignores bot messages.

### Role and Warning Management

- The bot periodically checks the database for users who have not sent a message in the last 14 days after their timestamp and sends a warning message.
- It removes a specified role from users who haven't sent a message within 30 days after their timestamp.
- The bot ensures that a user will not receive multiple warning messages within a 14-day period by utilizing a `last_warning` timestamp.
- The bot ignores bot users during these checks and operations.

### Database Cleanup

- The bot periodically fetches current members of the guild.
- It removes any users from the database who are no longer in the server.

## Setup

### Prerequisites

- Node.js
- npm
- A Discord bot token
- SQLite3

### Installation

1. Clone the repository:
   ```sh
   git clone https://github.com/just-rich/discord-inactivity-bot.git
   cd discord-activity-bot
   ```

2. Install dependencies:
   ```sh
   npm install
   ```

3. Create a `.env` file in the root directory and add your bot token:
   ```env
   DISCORD_BOT_TOKEN=YOUR_BOT_TOKEN
   ```

### Configuration

- Update the following constants in `index.js` with your server-specific values:
  ```javascript
  const GUILD_ID = 'YOUR_GUILD_ID';
  const CHANNEL_IDS = ['972240017898479616', '1325231273911914556'];  // Updated channel IDs
  const WARNING_CHANNEL_ID = 'WARNING_CHANNEL_ID';
  const ROLE_ID = 'ROLE_ID_TO_REMOVE';
  ```

### Running the Bot

```sh
node index.js
```
