'use strict';

require('dotenv').config();

const crypto = require('node:crypto');
const path = require('node:path');
const express = require('express');
const mysql = require('mysql2/promise');

const requiredEnv = ['BOT_TOKEN', 'DATABASE_HOST', 'DATABASE_USER', 'DATABASE_PASSWORD', 'DATABASE_NAME', 'MINI_APP_URL', 'ADMIN_TELEGRAM_ID', 'WEBHOOK_SECRET', 'SETUP_SECRET', 'CRON_SECRET'];
const missingEnv = requiredEnv.filter((name) => !process.env[name]);
if (missingEnv.length) {
  throw new Error(`Missing required environment variables: ${missingEnv.join(', ')}`);
}
for (const name of ['WEBHOOK_SECRET', 'SETUP_SECRET', 'CRON_SECRET']) {
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(process.env[name])) {
    throw new Error(`${name} must be a 32-256 character URL-safe secret. Generate one with crypto.randomBytes(32).toString('base64url').`);
  }
}
if (new Set([process.env.WEBHOOK_SECRET, process.env.SETUP_SECRET, process.env.CRON_SECRET]).size !== 3) {
  throw new Error('WEBHOOK_SECRET, SETUP_SECRET, and CRON_SECRET must be different values.');
}

function validConfiguredMoney(value) {
  if (!/^\d{1,16}(?:\.\d{1,2})?$/.test(value)) {
    throw new Error('REFERRAL_REWARD must be a non-negative amount with at most two decimal places.');
  }
  return value;
}

const config = {
  botToken: process.env.BOT_TOKEN,
  adminId: String(process.env.ADMIN_TELEGRAM_ID),
  webhookSecret: process.env.WEBHOOK_SECRET,
  setupSecret: process.env.SETUP_SECRET,
  cronSecret: process.env.CRON_SECRET,
  appUrl: process.env.MINI_APP_URL.replace(/\/+$/, ''),
  publicUrl: (process.env.WEBHOOK_BASE_URL || process.env.MINI_APP_URL).replace(/\/+$/, ''),
  botUsername: (process.env.BOT_USERNAME || '').replace(/^@/, ''),
  supportUsername: (process.env.SUPPORT_USERNAME || '').replace(/^@/, ''),
  channelUrl: process.env.CHANNEL_URL || process.env.SUPPORT_CHANNEL_URL || '',
  supportUrl: process.env.SUPPORT_URL || '',
  channelChatId: process.env.CHANNEL_CHAT_ID || '',
  requireChannelMembership: process.env.REQUIRE_CHANNEL_MEMBERSHIP === 'true',
  dbHost: process.env.DATABASE_HOST,
  dbPort: Number(process.env.DATABASE_PORT || 4000),
  dbUser: process.env.DATABASE_USER,
  dbPassword: process.env.DATABASE_PASSWORD,
  dbName: process.env.DATABASE_NAME,
  paymentMethods: [
    {
      method: 'TELEBIRR',
      label: 'Telebirr',
      account: process.env.TELEBIRR_ACCOUNT || '',
      accountName: process.env.TELEBIRR_ACCOUNT_NAME || '',
    },
    {
      method: 'CBE',
      label: 'CBE',
      account: process.env.CBE_ACCOUNT || '',
      accountName: process.env.CBE_ACCOUNT_NAME || '',
    },
  ].filter((method) => method.account && method.accountName),
  withdrawalMinimum: '50.00',
  referralReward: validConfiguredMoney(process.env.REFERRAL_REWARD || '0'),
};

const pool = mysql.createPool({
  host: config.dbHost,
  port: config.dbPort,
  user: config.dbUser,
  password: config.dbPassword,
  database: config.dbName,
  waitForConnections: true,
  connectionLimit: Number(process.env.DATABASE_CONNECTION_LIMIT || 10),
  queueLimit: 0,
  connectTimeout: 10000,
  enableKeepAlive: true,
  ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
  decimalNumbers: false,
});
const cartelaPrice = '10.00';
const roomMinPlayers = 3;
const roomMaxPlayers = 20;
const maxCartelasPerPlayer = 2;
const roomCountdownSeconds = 30;

let schemaPromise;
function initializeSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
          telegram_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
          username VARCHAR(64) NULL,
          first_name VARCHAR(128) NOT NULL,
          last_name VARCHAR(128) NULL,
          language VARCHAR(2) NOT NULL DEFAULT 'en',
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS wallets (
          telegram_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
          balance DECIMAL(20, 2) NOT NULL DEFAULT 0.00,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          CONSTRAINT fk_wallet_user FOREIGN KEY (telegram_id) REFERENCES users (telegram_id)
        ) ENGINE=InnoDB
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS deposit_requests (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
          telegram_id BIGINT UNSIGNED NOT NULL,
          method VARCHAR(16) NOT NULL,
          amount DECIMAL(20, 2) NOT NULL,
          provider_reference VARCHAR(128) NOT NULL,
          status VARCHAR(16) NOT NULL DEFAULT 'PENDING',
          reviewed_by BIGINT UNSIGNED NULL,
          reviewed_at TIMESTAMP NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY uq_deposit_method_reference (method, provider_reference),
          KEY idx_deposit_user_created (telegram_id, created_at),
          KEY idx_deposit_status_created (status, created_at),
          CONSTRAINT fk_deposit_user FOREIGN KEY (telegram_id) REFERENCES users (telegram_id)
        ) ENGINE=InnoDB
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS wallet_transactions (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
          telegram_id BIGINT UNSIGNED NOT NULL,
          type VARCHAR(32) NOT NULL,
          amount DECIMAL(20, 2) NOT NULL,
          balance_before DECIMAL(20, 2) NOT NULL,
          balance_after DECIMAL(20, 2) NOT NULL,
          reference_id BIGINT UNSIGNED NOT NULL,
          description VARCHAR(255) NOT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY uq_wallet_transaction_reference (type, reference_id),
          KEY idx_wallet_transaction_user_created (telegram_id, created_at),
          CONSTRAINT fk_transaction_user FOREIGN KEY (telegram_id) REFERENCES users (telegram_id)
        ) ENGINE=InnoDB
      `);
      const [referralColumn] = await pool.execute(
        `SELECT COUNT(*) AS count FROM information_schema.columns
         WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'referral_code'`,
      );
      if (!Number(referralColumn[0].count)) {
        try {
          await pool.query('ALTER TABLE users ADD COLUMN referral_code VARCHAR(16) NULL');
        } catch (error) {
          if (error.code !== 'ER_DUP_FIELDNAME' && error.errno !== 1060) throw error;
        }
      }
      const [referralIndex] = await pool.execute(
        `SELECT COUNT(*) AS count FROM information_schema.statistics
         WHERE table_schema = DATABASE() AND table_name = 'users' AND index_name = 'uq_users_referral_code'`,
      );
      if (!Number(referralIndex[0].count)) {
        try {
          await pool.query('CREATE UNIQUE INDEX uq_users_referral_code ON users (referral_code)');
        } catch (error) {
          if (error.code !== 'ER_DUP_KEYNAME' && error.errno !== 1061) throw error;
        }
      }
      await pool.query(`
        CREATE TABLE IF NOT EXISTS referral_relationships (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
          referrer_telegram_id BIGINT UNSIGNED NOT NULL,
          referred_telegram_id BIGINT UNSIGNED NOT NULL,
          referral_code VARCHAR(16) NOT NULL,
          status VARCHAR(16) NOT NULL DEFAULT 'PENDING',
          reward_amount DECIMAL(20, 2) NOT NULL DEFAULT 0.00,
          qualified_at TIMESTAMP NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY uq_referral_referred (referred_telegram_id),
          KEY idx_referral_referrer_status (referrer_telegram_id, status),
          CONSTRAINT fk_referral_referrer FOREIGN KEY (referrer_telegram_id) REFERENCES users (telegram_id),
          CONSTRAINT fk_referral_referred FOREIGN KEY (referred_telegram_id) REFERENCES users (telegram_id)
        ) ENGINE=InnoDB
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS withdrawal_requests (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
          telegram_id BIGINT UNSIGNED NOT NULL,
          idempotency_key VARCHAR(64) NOT NULL,
          amount DECIMAL(20, 2) NOT NULL,
          payout_method VARCHAR(24) NOT NULL,
          payout_details VARCHAR(191) NOT NULL,
          status VARCHAR(16) NOT NULL DEFAULT 'PENDING',
          reviewed_by BIGINT UNSIGNED NULL,
          reviewed_at TIMESTAMP NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY uq_withdrawal_idempotency (idempotency_key),
          KEY idx_withdrawal_user_created (telegram_id, created_at),
          KEY idx_withdrawal_status_created (status, created_at),
          CONSTRAINT fk_withdrawal_user FOREIGN KEY (telegram_id) REFERENCES users (telegram_id)
        ) ENGINE=InnoDB
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS user_flows (
          telegram_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
          flow VARCHAR(24) NOT NULL,
          step VARCHAR(32) NOT NULL,
          data JSON NOT NULL,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          CONSTRAINT fk_flow_user FOREIGN KEY (telegram_id) REFERENCES users (telegram_id)
        ) ENGINE=InnoDB
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS admin_audit_logs (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
          admin_telegram_id BIGINT UNSIGNED NOT NULL,
          action VARCHAR(64) NOT NULL,
          entity_type VARCHAR(32) NOT NULL,
          entity_id BIGINT UNSIGNED NOT NULL,
          details VARCHAR(255) NOT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          KEY idx_admin_audit_created (created_at)
        ) ENGINE=InnoDB
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS bingo_rooms (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
          room_number VARCHAR(24) NOT NULL,
          stake DECIMAL(20, 2) NOT NULL,
          min_players INT UNSIGNED NOT NULL,
          max_players INT UNSIGNED NOT NULL,
          prize_pool DECIMAL(20, 2) NOT NULL DEFAULT 0.00,
          status VARCHAR(16) NOT NULL DEFAULT 'WAITING',
          created_by BIGINT UNSIGNED NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          started_at TIMESTAMP(3) NULL,
          draw_order JSON NULL,
          claim_deadline TIMESTAMP NULL,
          selection_started_at TIMESTAMP NULL,
          selection_deadline TIMESTAMP NULL,
          finished_at TIMESTAMP NULL,
          last_call_at TIMESTAMP NULL,
          KEY idx_room_status_created (status, created_at),
          CONSTRAINT fk_room_creator FOREIGN KEY (created_by) REFERENCES users (telegram_id)
        ) ENGINE=InnoDB
      `);
      const [creatorColumn] = await pool.execute(
        `SELECT is_nullable FROM information_schema.columns
         WHERE table_schema = DATABASE() AND table_name = 'bingo_rooms' AND column_name = 'created_by'`,
      );
      if (creatorColumn[0]?.is_nullable === 'NO') {
        await pool.query('ALTER TABLE bingo_rooms MODIFY created_by BIGINT UNSIGNED NULL');
      }
      const [countdownColumns] = await pool.execute(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = DATABASE() AND table_name = 'bingo_rooms'
           AND column_name IN ('selection_started_at', 'selection_deadline')`,
      );
      const existingCountdownColumns = new Set(countdownColumns.map((column) => column.column_name));
      if (!existingCountdownColumns.has('selection_started_at')) {
        await pool.query('ALTER TABLE bingo_rooms ADD COLUMN selection_started_at TIMESTAMP NULL');
      }
      if (!existingCountdownColumns.has('selection_deadline')) {
        await pool.query('ALTER TABLE bingo_rooms ADD COLUMN selection_deadline TIMESTAMP NULL');
      }
      const [drawOrderColumns] = await pool.execute(
        `SELECT COUNT(*) AS count FROM information_schema.columns
         WHERE table_schema = DATABASE() AND table_name = 'bingo_rooms' AND column_name = 'draw_order'`,
      );
      if (!Number(drawOrderColumns[0].count)) {
        await pool.query('ALTER TABLE bingo_rooms ADD COLUMN draw_order JSON NULL');
      }
      const [startedAtColumn] = await pool.execute(
        `SELECT datetime_precision FROM information_schema.columns
         WHERE table_schema = DATABASE() AND table_name = 'bingo_rooms' AND column_name = 'started_at'`,
      );
      if (startedAtColumn[0] && Number(startedAtColumn[0].datetime_precision || 0) < 3) {
        await pool.query('ALTER TABLE bingo_rooms MODIFY started_at TIMESTAMP(3) NULL');
      }
      const [claimDeadlineColumns] = await pool.execute(
        `SELECT COUNT(*) AS count FROM information_schema.columns
         WHERE table_schema = DATABASE() AND table_name = 'bingo_rooms' AND column_name = 'claim_deadline'`,
      );
      if (!Number(claimDeadlineColumns[0].count)) {
        await pool.query('ALTER TABLE bingo_rooms ADD COLUMN claim_deadline TIMESTAMP NULL');
      }
      await pool.query(
        `UPDATE bingo_rooms SET
           selection_started_at = COALESCE(selection_started_at, created_at),
           selection_deadline = COALESCE(selection_deadline,
             DATE_ADD(COALESCE(selection_started_at, created_at), INTERVAL ${roomCountdownSeconds} SECOND))
         WHERE selection_started_at IS NULL OR selection_deadline IS NULL`,
      );
      await pool.execute(
        "UPDATE bingo_rooms SET min_players = ? WHERE status = 'WAITING' AND min_players <> ?",
        [roomMinPlayers, roomMinPlayers],
      );
      await pool.query(`
        CREATE TABLE IF NOT EXISTS bingo_lobby_lock (
          id TINYINT UNSIGNED NOT NULL PRIMARY KEY
        ) ENGINE=InnoDB
      `);
      await pool.execute('INSERT IGNORE INTO bingo_lobby_lock (id) VALUES (1)');
      await pool.query(`
        CREATE TABLE IF NOT EXISTS bingo_players (
          room_id BIGINT UNSIGNED NOT NULL,
          telegram_id BIGINT UNSIGNED NOT NULL,
          joined_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          left_at TIMESTAMP NULL,
          PRIMARY KEY (room_id, telegram_id),
          KEY idx_bingo_player_user (telegram_id, joined_at),
          CONSTRAINT fk_bingo_player_room FOREIGN KEY (room_id) REFERENCES bingo_rooms (id),
          CONSTRAINT fk_bingo_player_user FOREIGN KEY (telegram_id) REFERENCES users (telegram_id)
        ) ENGINE=InnoDB
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS cartela_slots (
          room_id BIGINT UNSIGNED NOT NULL,
          cartela_number INT UNSIGNED NOT NULL,
          numbers JSON NOT NULL,
          owner_telegram_id BIGINT UNSIGNED NULL,
          PRIMARY KEY (room_id, cartela_number),
          KEY idx_cartela_owner (room_id, owner_telegram_id),
          CONSTRAINT fk_cartela_room FOREIGN KEY (room_id) REFERENCES bingo_rooms (id),
          CONSTRAINT fk_cartela_owner FOREIGN KEY (owner_telegram_id) REFERENCES users (telegram_id)
        ) ENGINE=InnoDB
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS cartela_reservations (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
          room_id BIGINT UNSIGNED NOT NULL,
          cartela_number INT UNSIGNED NOT NULL,
          telegram_id BIGINT UNSIGNED NOT NULL,
          amount DECIMAL(20, 2) NOT NULL,
          status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          released_at TIMESTAMP NULL,
          KEY idx_reservation_room_status (room_id, status),
          KEY idx_reservation_user_status (telegram_id, status),
          CONSTRAINT fk_reservation_room FOREIGN KEY (room_id) REFERENCES bingo_rooms (id),
          CONSTRAINT fk_reservation_user FOREIGN KEY (telegram_id) REFERENCES users (telegram_id)
        ) ENGINE=InnoDB
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS game_calls (
          room_id BIGINT UNSIGNED NOT NULL,
          draw_index INT UNSIGNED NOT NULL,
          number INT UNSIGNED NOT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (room_id, draw_index),
          UNIQUE KEY uq_game_call_number (room_id, number),
          CONSTRAINT fk_game_call_room FOREIGN KEY (room_id) REFERENCES bingo_rooms (id)
        ) ENGINE=InnoDB
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS game_winners (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
          room_id BIGINT UNSIGNED NOT NULL,
          telegram_id BIGINT UNSIGNED NOT NULL,
          cartela_number INT UNSIGNED NOT NULL,
          pattern VARCHAR(32) NOT NULL,
          prize DECIMAL(20, 2) NOT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY uq_game_winner_card (room_id, cartela_number),
          KEY idx_game_winner_user (telegram_id, created_at),
          CONSTRAINT fk_game_winner_room FOREIGN KEY (room_id) REFERENCES bingo_rooms (id),
          CONSTRAINT fk_game_winner_user FOREIGN KEY (telegram_id) REFERENCES users (telegram_id)
        ) ENGINE=InnoDB
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS game_claims (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
          room_id BIGINT UNSIGNED NOT NULL,
          telegram_id BIGINT UNSIGNED NOT NULL,
          cartela_number INT UNSIGNED NOT NULL,
          pattern VARCHAR(32) NOT NULL,
          call_index INT UNSIGNED NOT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY uq_game_claim_card (room_id, cartela_number),
          KEY idx_game_claim_room_created (room_id, created_at),
          CONSTRAINT fk_game_claim_room FOREIGN KEY (room_id) REFERENCES bingo_rooms (id),
          CONSTRAINT fk_game_claim_user FOREIGN KEY (telegram_id) REFERENCES users (telegram_id)
        ) ENGINE=InnoDB
      `);
    })().catch((error) => {
      schemaPromise = undefined;
      throw error;
    });
  }
  return schemaPromise;
}

const text = {
  en: {
    welcome: (name) => `Welcome to SHISHO BINGO, ${name}!`,
    menu: 'Choose an option below. Open Play for the Mini App.',
    play: '🎮 Play',
    balance: '💰 Balance',
    deposit: '💳 Deposit',
    withdraw: '💸 Withdraw',
    invite: '🔗 Invite',
    profile: '👤 Profile',
    history: '📜 History',
    support: '💬 Support',
    channel: '📢 Channel',
    language: '🌐 Language',
    wallet: (amount) => `Your wallet balance is ${amount} BIRR.`,
    walletError: 'I could not load your wallet right now. Please try again shortly.',
    depositPending: 'Your deposit request was submitted for admin review.',
    depositInvalid: 'Enter a valid amount and the transaction/reference ID from your payment.',
    depositDisabled: 'Deposits are not configured yet. Please try again later.',
    notConfigured: 'This feature is not enabled yet. No money has been moved.',
    chooseLanguage: 'Choose your language:',
    languageSaved: 'Language updated.',
    supportInfo: 'For help, contact the support team.',
    channelUnavailable: 'The official channel link is not configured yet.',
    choosePaymentMethod: 'Choose a deposit method:',
    enterDepositAmount: 'Enter the amount in BIRR.',
    enterDepositReference: 'Enter the transaction/reference ID from your payment.',
    withdrawalInfo: (balance, minimum) => `Available balance: ${balance} BIRR\nMinimum withdrawal: ${minimum} BIRR\nFee: 0 BIRR\nPending requests reserve their amount until approved or rejected.\n\nEnter the amount to withdraw, or Cancel.`,
    withdrawalMethod: 'Choose how you want to receive the withdrawal:',
    withdrawalDetails: 'Enter your Telebirr phone number or CBE account details.',
    withdrawalConfirm: (amount, method, details) => `Confirm withdrawal request:\nAmount: ${amount} BIRR\nFee: 0 BIRR\nMethod: ${method}\nAccount: ${details}`,
    withdrawalPending: (id) => `Withdrawal request #${id} is pending admin review. The requested funds are reserved; no payout has been made yet.`,
    withdrawalDisabled: 'Withdrawals are currently unavailable.',
    cancelled: 'Request cancelled.',
    invalidAmount: 'Enter a valid positive amount with up to two decimal places.',
    insufficientFunds: 'That amount exceeds your available balance after pending withdrawal reservations.',
    minimumWithdrawal: (minimum) => `The minimum withdrawal is ${minimum} BIRR.`,
    profileTitle: '👤 YOUR PROFILE',
    historyEmpty: 'No wallet transactions yet.',
    inviteInfo: (url, count) => `🔗 Invite friends to SHISHO BINGO\n\nYour invite link:\n${url}\n\nSuccessful referrals: ${count}\nReferral reward, if enabled, is granted after your invited friend’s first approved deposit.`,
    supportPrompt: 'What do you need help with?',
    channelJoin: 'Join the official SHISHO BINGO channel, then verify your membership.',
    channelVerified: 'Channel membership verified.',
    channelNotMember: 'You are not yet a member of the official channel.',
    channelVerifyUnavailable: 'Channel membership verification is not configured. You can still join using the channel link.',
    depositApproved: (amount, balance) => `✅ Deposit approved\n${amount} BIRR added to your wallet.\nNew balance: ${balance} BIRR.`,
    depositRejected: (id) => `❌ Deposit request #${id} was rejected. Your wallet was not changed.`,
    withdrawalApproved: (amount, balance) => `✅ Withdrawal request approved for ${amount} BIRR. The payout has been confirmed by the administrator.\nWallet balance: ${balance} BIRR.`,
    withdrawalRejected: (id) => `❌ Withdrawal request #${id} was rejected. Reserved funds are available in your wallet again.`,
    adminOnly: 'This action is available only to the configured administrator.',
  },
  am: {
    welcome: (name) => `ወደ SHISHO BINGO እንኳን ደህና መጡ፣ ${name}!`,
    menu: 'ከታች ያለውን ይምረጡ። ሚኒ አፑን ለመክፈት ጨዋታን ይጫኑ።',
    play: '🎮 ጨዋታ',
    balance: '💰 ቀሪ ሂሳብ',
    deposit: '💳 ገንዘብ አስገባ',
    withdraw: '💸 ገንዘብ አውጣ',
    invite: '🔗 ጋብዝ',
    profile: '👤 መገለጫ',
    history: '📜 ታሪክ',
    support: '💬 ድጋፍ',
    channel: '📢 ቻናል',
    language: '🌐 ቋንቋ',
    wallet: (amount) => `የኪስ ቦርሳዎ ቀሪ ሂሳብ ${amount} ብር ነው።`,
    walletError: 'የኪስ ቦርሳውን አሁን ማሳየት አልቻልኩም። እባክዎ ቆይተው ይሞክሩ።',
    depositPending: 'የገንዘብ ማስገቢያ ጥያቄዎ ለአስተዳዳሪ ተልኳል።',
    depositInvalid: 'ትክክለኛ መጠን እና ከክፍያዎ የግብይት መለያ ያስገቡ።',
    depositDisabled: 'የገንዘብ ማስገባት አገልግሎት ገና አልተዘጋጀም።',
    notConfigured: 'ይህ አገልግሎት ገና አልተዘጋጀም። ምንም ገንዘብ አልተንቀሳቀሰም።',
    chooseLanguage: 'ቋንቋዎን ይምረጡ፦',
    languageSaved: 'ቋንቋው ተቀይሯል።',
    supportInfo: 'ለእርዳታ የድጋፍ ቡድኑን ያነጋግሩ።',
    channelUnavailable: 'የኦፊሴላዊው ቻናል አድራሻ ገና አልተዘጋጀም።',
    choosePaymentMethod: 'የገንዘብ ማስገቢያ ዘዴ ይምረጡ፦',
    enterDepositAmount: 'መጠኑን በብር ያስገቡ።',
    enterDepositReference: 'ከክፍያዎ የግብይት መለያ ያስገቡ።',
    withdrawalInfo: (balance, minimum) => `ያለ ቀሪ ሂሳብ፦ ${balance} ብር\nዝቅተኛ የማውጫ መጠን፦ ${minimum} ብር\nክፍያ፦ 0 ብር\nየሚጠባበቁ ጥያቄዎች እስኪጸድቁ ወይም ውድቅ እስኪደረጉ ድረስ ገንዘቡን ይይዛሉ።\n\nለማውጣት የሚፈልጉትን መጠን ያስገቡ ወይም Cancel ይጫኑ።`,
    withdrawalMethod: 'ገንዘቡን የሚቀበሉበትን ዘዴ ይምረጡ፦',
    withdrawalDetails: 'የቴሌብር ስልክ ቁጥርዎን ወይም የCBE ሂሳብ ያስገቡ።',
    withdrawalConfirm: (amount, method, details) => `የገንዘብ ማውጫ ጥያቄውን ያረጋግጡ፦\nመጠን፦ ${amount} ብር\nክፍያ፦ 0 ብር\nዘዴ፦ ${method}\nሂሳብ፦ ${details}`,
    withdrawalPending: (id) => `የማውጫ ጥያቄ #${id} የአስተዳዳሪ ግምገማ እየጠበቀ ነው። ገንዘቡ ተይዟል፤ ክፍያ ገና አልተፈጸመም።`,
    withdrawalDisabled: 'የገንዘብ ማውጫ አገልግሎት ለጊዜው ዝግ ነው።',
    cancelled: 'ጥያቄው ተሰርዟል።',
    invalidAmount: 'ትክክለኛ አዎንታዊ መጠን እስከ ሁለት የአስርዮሽ ቦታ ያስገቡ።',
    insufficientFunds: 'ይህ መጠን ከተያዙ ገንዘቦች በኋላ ካለው ቀሪ ሂሳብ ይበልጣል።',
    minimumWithdrawal: (minimum) => `ዝቅተኛው የማውጫ መጠን ${minimum} ብር ነው።`,
    profileTitle: '👤 የእርስዎ መገለጫ',
    historyEmpty: 'ገና የኪስ ቦርሳ ግብይቶች የሉም።',
    inviteInfo: (url, count) => `🔗 ጓደኞችዎን ወደ SHISHO BINGO ይጋብዙ።\n\nየግብዣ አገናኝዎ፦\n${url}\n\nየተሳኩ ግብዣዎች፦ ${count}\nሽልማት ከነቃ በተጋበዘው ሰው የመጀመሪያ የጸደቀ ገንዘብ ማስገባት በኋላ ይሰጣል።`,
    supportPrompt: 'እርዳታ የሚፈልጉበትን ይምረጡ።',
    channelJoin: 'ወደ ኦፊሴላዊው SHISHO BINGO ቻናል ይቀላቀሉ፣ ከዚያ አባልነትዎን ያረጋግጡ።',
    channelVerified: 'የቻናል አባልነት ተረጋግጧል።',
    channelNotMember: 'እስካሁን የኦፊሴላዊው ቻናል አባል አይደሉም።',
    channelVerifyUnavailable: 'የቻናል አባልነት ማረጋገጫ አልተዘጋጀም። አሁንም በአገናኙ መቀላቀል ይችላሉ።',
    depositApproved: (amount, balance) => `✅ ገንዘብ ማስገባት ጸድቋል።\n${amount} ብር ወደ ኪስ ቦርሳዎ ተጨምሯል።\nአዲስ ቀሪ ሂሳብ፦ ${balance} ብር።`,
    depositRejected: (id) => `❌ የገንዘብ ማስገቢያ ጥያቄ #${id} ውድቅ ተደርጓል። ቀሪ ሂሳብዎ አልተቀየረም።`,
    withdrawalApproved: (amount, balance) => `✅ የ${amount} ብር ማውጫ ጥያቄ ጸድቋል። አስተዳዳሪው ክፍያውን አረጋግጠዋል።\nቀሪ ሂሳብ፦ ${balance} ብር።`,
    withdrawalRejected: (id) => `❌ የማውጫ ጥያቄ #${id} ውድቅ ተደርጓል። የተያዘው ገንዘብ ወደ ቀሪ ሂሳብዎ ተመልሷል።`,
    adminOnly: 'ይህ እርምጃ ለተዋቀረው አስተዳዳሪ ብቻ ነው።',
  },
};

const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => {
  req.requestId = crypto.randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});
app.use(express.json({ limit: '256kb' }));

function languageOf(value) {
  return value === 'am' ? 'am' : 'en';
}

function telegramApi(method, payload = {}) {
  return fetch(`https://api.telegram.org/bot${config.botToken}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10000),
  }).then(async (response) => {
    const result = await response.json();
    if (!response.ok || !result.ok) {
      throw new Error(`Telegram ${method} failed: ${result.description || response.statusText}`);
    }
    return result.result;
  });
}

function keyboardFor(lang) {
  const t = text[lang];
  return {
    keyboard: [
      [{ text: t.play, web_app: { url: config.appUrl } }],
      [{ text: t.balance }, { text: t.profile }],
      [{ text: t.deposit }, { text: t.withdraw }],
      [{ text: t.invite }, { text: t.support }],
      [{ text: t.channel }],
      [{ text: t.language }],
    ],
    resize_keyboard: true,
    is_persistent: true,
  };
}

async function upsertUser(user) {
  await initializeSchema();
  const id = String(user.id);
  const firstName = String(user.first_name || 'Player').slice(0, 128);
  const lastName = user.last_name ? String(user.last_name).slice(0, 128) : null;
  const username = user.username ? String(user.username).slice(0, 64) : null;
  const defaultLanguage = String(user.language_code || '').toLowerCase().startsWith('am') ? 'am' : 'en';
  await pool.execute(
    `INSERT INTO users (telegram_id, username, first_name, last_name, language)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE username = VALUES(username), first_name = VALUES(first_name),
       last_name = VALUES(last_name), updated_at = CURRENT_TIMESTAMP`,
    [id, username, firstName, lastName, defaultLanguage],
  );
  await pool.execute('INSERT IGNORE INTO wallets (telegram_id) VALUES (?)', [id]);
  await ensureReferralCode(id);
  return { id, firstName, username };
}

async function ensureReferralCode(telegramId) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = crypto.randomBytes(9).toString('base64url').slice(0, 12);
    try {
      await pool.execute(
        'UPDATE users SET referral_code = ? WHERE telegram_id = ? AND referral_code IS NULL',
        [code, String(telegramId)],
      );
      const [rows] = await pool.execute('SELECT referral_code FROM users WHERE telegram_id = ?', [String(telegramId)]);
      if (!rows[0]?.referral_code) throw new Error('Could not assign a referral code to the user.');
      return rows[0].referral_code;
    } catch (error) {
      if (error.code !== 'ER_DUP_ENTRY' || attempt === 4) throw error;
    }
  }
  throw new Error('Could not assign a unique referral code.');
}

async function attributeReferral(newUserId, startPayload) {
  const match = /^ref_([A-Za-z0-9_-]{6,16})$/.exec(String(startPayload || ''));
  if (!match) return false;
  const [referrers] = await pool.execute(
    'SELECT telegram_id FROM users WHERE referral_code = ? LIMIT 1',
    [match[1]],
  );
  const referrerId = referrers[0] ? String(referrers[0].telegram_id) : '';
  if (!referrerId || referrerId === String(newUserId)) return false;
  try {
    await pool.execute(
      `INSERT INTO referral_relationships
        (referrer_telegram_id, referred_telegram_id, referral_code, reward_amount)
       VALUES (?, ?, ?, ?)`,
      [referrerId, String(newUserId), match[1], config.referralReward],
    );
    return true;
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') return false;
    throw error;
  }
}

async function getUser(id) {
  await initializeSchema();
  const [rows] = await pool.execute(
    `SELECT u.telegram_id, u.username, u.first_name, u.last_name, u.language, u.referral_code, w.balance
     FROM users u JOIN wallets w ON w.telegram_id = u.telegram_id
     WHERE u.telegram_id = ? LIMIT 1`,
    [String(id)],
  );
  return rows[0] || null;
}

async function getAvailableBalance(telegramId, connection = pool) {
  const [rows] = await connection.execute(
    `SELECT w.balance,
       COALESCE((SELECT SUM(r.amount) FROM withdrawal_requests r
                 WHERE r.telegram_id = w.telegram_id AND r.status = 'PENDING'), 0.00) AS reserved
     FROM wallets w WHERE w.telegram_id = ?`,
    [String(telegramId)],
  );
  if (!rows[0]) throw new Error('Wallet not found.');
  const available = decimalToMinorUnits(rows[0].balance) - decimalToMinorUnits(rows[0].reserved);
  return minorUnitsToDecimal(available);
}

async function getUserFlow(telegramId) {
  const [rows] = await pool.execute('SELECT flow, step, data FROM user_flows WHERE telegram_id = ?', [String(telegramId)]);
  if (!rows[0]) return null;
  return {
    flow: rows[0].flow,
    step: rows[0].step,
    data: typeof rows[0].data === 'string' ? JSON.parse(rows[0].data) : rows[0].data,
  };
}

async function setUserFlow(telegramId, flow, step, data) {
  await pool.execute(
    `INSERT INTO user_flows (telegram_id, flow, step, data) VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE flow = VALUES(flow), step = VALUES(step), data = VALUES(data)`,
    [String(telegramId), flow, step, JSON.stringify(data)],
  );
}

async function clearUserFlow(telegramId) {
  await pool.execute('DELETE FROM user_flows WHERE telegram_id = ?', [String(telegramId)]);
}

function decimalToMinorUnits(value) {
  const [whole, fraction = ''] = String(value).split('.');
  return BigInt(whole) * 100n + BigInt((fraction + '00').slice(0, 2));
}

function minorUnitsToDecimal(value) {
  const amount = BigInt(value);
  return `${amount / 100n}.${String(amount % 100n).padStart(2, '0')}`;
}

function validDepositAmount(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const amount = String(value).trim();
  if (!/^\d{1,16}(?:\.\d{1,2})?$/.test(amount)) return null;
  try {
    const cents = decimalToMinorUnits(amount);
    return cents > 0n ? minorUnitsToDecimal(cents) : null;
  } catch {
    return null;
  }
}

function formatAmount(value) {
  return minorUnitsToDecimal(decimalToMinorUnits(value));
}

function depositReviewKeyboard(id) {
  return {
    inline_keyboard: [[
      { text: '✅ Approve', callback_data: `deposit:approve:${id}` },
      { text: '❌ Reject', callback_data: `deposit:reject:${id}` },
    ]],
  };
}

function withdrawalReviewKeyboard(id) {
  return {
    inline_keyboard: [[
      { text: '✅ Confirm paid & approve', callback_data: `withdraw:approve:${id}` },
      { text: '❌ Reject', callback_data: `withdraw:reject:${id}` },
    ]],
  };
}

function supportKeyboard(lang) {
  const t = text[lang];
  return {
    inline_keyboard: [
      [{ text: '💳 ' + t.deposit.replace(/^💳\s*/, ''), callback_data: 'help:deposits' },
        { text: '💸 ' + t.withdraw.replace(/^💸\s*/, ''), callback_data: 'help:withdrawals' }],
      [{ text: '💰 ' + t.balance.replace(/^💰\s*/, ''), callback_data: 'help:wallet' },
        { text: '🎟 Cartelas', callback_data: 'help:cartela' }],
      [{ text: '🎮 Game rules', callback_data: 'help:rules' },
        { text: '🛠 Technical', callback_data: 'help:technical' }],
    ],
  };
}

async function notifyAdminOfDeposit(request) {
  const user = await getUser(request.telegramId);
  const message = [
    '💰 NEW DEPOSIT REQUEST',
    '',
    `Request: #${request.id}`,
    `User: ${user?.first_name || 'Player'}${user?.username ? ` (@${user.username})` : ''}`,
    `Telegram ID: ${request.telegramId}`,
    `Method: ${request.method}`,
    `Amount: ${request.amount} BIRR`,
    `Transaction ID: ${request.providerReference}`,
    'Status: PENDING',
  ].join('\n');
  await telegramApi('sendMessage', {
    chat_id: config.adminId,
    text: message,
    reply_markup: depositReviewKeyboard(request.id),
  });
}

async function notifyAdminOfWithdrawal(request) {
  const user = await getUser(request.telegramId);
  const message = [
    '💸 NEW WITHDRAWAL REQUEST',
    '',
    `Request: #${request.id}`,
    `User: ${user?.first_name || 'Player'}${user?.username ? ` (@${user.username})` : ''}`,
    `Telegram ID: ${request.telegramId}`,
    `Amount: ${request.amount} BIRR`,
    `Payment method: ${request.method}`,
    `Account: ${request.details}`,
    `Available balance: ${request.availableBalance} BIRR`,
    'Status: PENDING — verify payout before approval.',
  ].join('\n');
  await telegramApi('sendMessage', {
    chat_id: config.adminId,
    text: message,
    reply_markup: withdrawalReviewKeyboard(request.id),
  });
}

async function createWithdrawalRequest(telegramId, amountInput, method, detailsInput, idempotencyKey) {
  const amount = validDepositAmount(amountInput);
  const details = typeof detailsInput === 'string' ? detailsInput.trim() : '';
  if (!amount) throw Object.assign(new Error(text.en.invalidAmount), { status: 400 });
  if (decimalToMinorUnits(amount) < decimalToMinorUnits(config.withdrawalMinimum)) {
    throw Object.assign(new Error(text.en.minimumWithdrawal(config.withdrawalMinimum)), { status: 400 });
  }
  if (!/^[A-Za-z0-9_-]{24,64}$/.test(String(idempotencyKey || '')) ||
      !['TELEBIRR', 'CBE'].includes(method) || details.length < 5 || details.length > 191 ||
      /[\u0000-\u001f\u007f]/.test(details)) {
    throw Object.assign(new Error('Choose Telebirr or CBE and provide valid payout details.'), { status: 400 });
  }

  const connection = await pool.getConnection();
  let request;
  try {
    await connection.beginTransaction();
    const [wallets] = await connection.execute(
      'SELECT balance FROM wallets WHERE telegram_id = ? FOR UPDATE',
      [String(telegramId)],
    );
    if (!wallets[0]) throw new Error('Wallet not found.');
    const availableBalance = await getAvailableBalance(telegramId, connection);
    if (decimalToMinorUnits(amount) > decimalToMinorUnits(availableBalance)) {
      throw Object.assign(new Error(text.en.insufficientFunds), { status: 400 });
    }
    const [insert] = await connection.execute(
      `INSERT INTO withdrawal_requests (telegram_id, idempotency_key, amount, payout_method, payout_details)
       VALUES (?, ?, ?, ?, ?)`,
      [String(telegramId), idempotencyKey, amount, method, details],
    );
    request = {
      id: String(insert.insertId),
      telegramId: String(telegramId),
      amount,
      method,
      details,
      availableBalance,
    };
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    if (error.code === 'ER_DUP_ENTRY') {
      const [existing] = await pool.execute(
        `SELECT id, amount, payout_method FROM withdrawal_requests WHERE idempotency_key = ? LIMIT 1`,
        [idempotencyKey],
      );
      if (existing[0]) {
        return {
          id: String(existing[0].id),
          telegramId: String(telegramId),
          amount: formatAmount(existing[0].amount),
          method: existing[0].payout_method,
          notificationSent: true,
          duplicate: true,
        };
      }
    }
    throw error;
  } finally {
    connection.release();
  }

  try {
    await notifyAdminOfWithdrawal(request);
    request.notificationSent = true;
  } catch (error) {
    console.error(`Admin notification failed for withdrawal #${request.id}:`, error.message);
    request.notificationSent = false;
  }
  return request;
}

async function reviewWithdrawal(id, decision, adminId, reason = '') {
  const connection = await pool.getConnection();
  let outcome;
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      `SELECT id, telegram_id, amount, status FROM withdrawal_requests WHERE id = ? FOR UPDATE`,
      [id],
    );
    const request = rows[0];
    if (!request) {
      await connection.rollback();
      return { found: false };
    }
    if (request.status !== 'PENDING') {
      await connection.commit();
      return { found: true, status: request.status, changed: false };
    }

    let balanceAfter = null;
    if (decision === 'APPROVED') {
      const [wallets] = await connection.execute(
        'SELECT balance FROM wallets WHERE telegram_id = ? FOR UPDATE',
        [String(request.telegram_id)],
      );
      if (!wallets[0]) throw new Error(`Wallet not found for withdrawal ${id}.`);
      const balanceBefore = formatAmount(wallets[0].balance);
      if (decimalToMinorUnits(balanceBefore) < decimalToMinorUnits(request.amount)) {
        throw new Error(`Wallet balance is insufficient to approve withdrawal ${id}.`);
      }
      balanceAfter = minorUnitsToDecimal(
        decimalToMinorUnits(balanceBefore) - decimalToMinorUnits(request.amount),
      );
      await connection.execute(
        'UPDATE wallets SET balance = ? WHERE telegram_id = ?',
        [balanceAfter, String(request.telegram_id)],
      );
      await connection.execute(
        `INSERT INTO wallet_transactions
          (telegram_id, type, amount, balance_before, balance_after, reference_id, description)
         VALUES (?, 'WITHDRAWAL', ?, ?, ?, ?, ?)`,
        [
          String(request.telegram_id),
          formatAmount(request.amount),
          balanceBefore,
          balanceAfter,
          String(request.id),
          `Approved withdrawal #${request.id}`,
        ],
      );
    }
    await connection.execute(
      `UPDATE withdrawal_requests SET status = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'PENDING'`,
      [decision, String(adminId), id],
    );
    await connection.execute(
      `INSERT INTO admin_audit_logs (admin_telegram_id, action, entity_type, entity_id, details)
       VALUES (?, ?, 'WITHDRAWAL', ?, ?)`,
      [String(adminId), decision, String(id), (reason || `Withdrawal ${decision.toLowerCase()}`).slice(0, 255)],
    );
    await connection.commit();
    outcome = {
      found: true,
      status: decision,
      changed: true,
      telegramId: String(request.telegram_id),
      amount: formatAmount(request.amount),
      balanceAfter,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  if (outcome.changed) {
    const user = await getUser(outcome.telegramId);
    const lang = languageOf(user?.language);
    const message = decision === 'APPROVED'
      ? text[lang].withdrawalApproved(outcome.amount, outcome.balanceAfter)
      : `${text[lang].withdrawalRejected(id)}${reason ? `\nReason: ${reason}` : ''}`;
    try {
      await telegramApi('sendMessage', { chat_id: outcome.telegramId, text: message });
    } catch (error) {
      console.error(`User notification failed for withdrawal #${id}:`, error.message);
    }
  }
  return outcome;
}

async function createDepositRequest(telegramUser, method, amountInput, providerReferenceInput) {
  const amount = validDepositAmount(amountInput);
  const providerReference = typeof providerReferenceInput === 'string' ? providerReferenceInput.trim() : '';
  const configuredMethod = config.paymentMethods.find((item) => item.method === method);
  if (!configuredMethod) {
    throw Object.assign(new Error('That deposit method is not configured.'), { status: 400 });
  }
  if (!amount || providerReference.length < 3 || providerReference.length > 128 ||
      /[\u0000-\u001f\u007f]/.test(providerReference)) {
    throw Object.assign(new Error('Provide a positive amount (up to two decimals) and a valid transaction reference.'), { status: 400 });
  }

  const identity = await upsertUser(telegramUser);
  let result;
  try {
    const [insert] = await pool.execute(
      `INSERT INTO deposit_requests (telegram_id, method, amount, provider_reference)
       VALUES (?, ?, ?, ?)`,
      [identity.id, method, amount, providerReference],
    );
    result = { id: String(insert.insertId), telegramId: identity.id, method, amount, providerReference };
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      throw Object.assign(new Error('This payment transaction reference has already been submitted.'), { status: 409 });
    }
    throw error;
  }

  try {
    await notifyAdminOfDeposit(result);
    result.notificationSent = true;
  } catch (error) {
    console.error(`Admin notification failed for deposit #${result.id}:`, error.message);
    result.notificationSent = false;
  }
  return result;
}

async function reviewDeposit(id, decision, adminId, reason = '') {
  const connection = await pool.getConnection();
  let outcome;
  try {
    await connection.beginTransaction();
    const [deposits] = await connection.execute(
      `SELECT id, telegram_id, amount, status FROM deposit_requests WHERE id = ? FOR UPDATE`,
      [id],
    );
    const deposit = deposits[0];
    if (!deposit) {
      await connection.rollback();
      return { found: false };
    }
    if (deposit.status !== 'PENDING') {
      await connection.commit();
      return { found: true, status: deposit.status, changed: false };
    }

    let balanceAfter = null;
    if (decision === 'APPROVED') {
      const [wallets] = await connection.execute(
        'SELECT balance FROM wallets WHERE telegram_id = ? FOR UPDATE',
        [String(deposit.telegram_id)],
      );
      if (!wallets[0]) throw new Error(`Wallet not found for deposit ${id}.`);
      const balanceBefore = formatAmount(wallets[0].balance);
      balanceAfter = minorUnitsToDecimal(
        decimalToMinorUnits(balanceBefore) + decimalToMinorUnits(deposit.amount),
      );
      await connection.execute(
        'UPDATE wallets SET balance = ? WHERE telegram_id = ?',
        [balanceAfter, String(deposit.telegram_id)],
      );
      await connection.execute(
        `INSERT INTO wallet_transactions
          (telegram_id, type, amount, balance_before, balance_after, reference_id, description)
         VALUES (?, 'DEPOSIT', ?, ?, ?, ?, ?)`,
        [
          String(deposit.telegram_id),
          formatAmount(deposit.amount),
          balanceBefore,
          balanceAfter,
          String(deposit.id),
          `Approved deposit #${deposit.id}`,
        ],
      );
      const [qualified] = await connection.execute(
        `UPDATE referral_relationships SET status = 'QUALIFIED', qualified_at = CURRENT_TIMESTAMP
         WHERE referred_telegram_id = ? AND status = 'PENDING'`,
        [String(deposit.telegram_id)],
      );
      if (qualified.affectedRows) {
        const [referralRows] = await connection.execute(
          `SELECT id, referrer_telegram_id, reward_amount
           FROM referral_relationships WHERE referred_telegram_id = ?`,
          [String(deposit.telegram_id)],
        );
        const referral = referralRows[0];
        if (referral && decimalToMinorUnits(referral.reward_amount) > 0n) {
          const [referrerWallets] = await connection.execute(
            'SELECT balance FROM wallets WHERE telegram_id = ? FOR UPDATE',
            [String(referral.referrer_telegram_id)],
          );
          if (!referrerWallets[0]) throw new Error(`Referrer wallet missing for referral ${referral.id}.`);
          const before = formatAmount(referrerWallets[0].balance);
          const after = minorUnitsToDecimal(
            decimalToMinorUnits(before) + decimalToMinorUnits(referral.reward_amount),
          );
          await connection.execute(
            'UPDATE wallets SET balance = ? WHERE telegram_id = ?',
            [after, String(referral.referrer_telegram_id)],
          );
          await connection.execute(
            `INSERT INTO wallet_transactions
              (telegram_id, type, amount, balance_before, balance_after, reference_id, description)
             VALUES (?, 'REFERRAL_REWARD', ?, ?, ?, ?, ?)`,
            [
              String(referral.referrer_telegram_id),
              formatAmount(referral.reward_amount),
              before,
              after,
              String(referral.id),
              `Referral reward for referral #${referral.id}`,
            ],
          );
        }
      }
    }
    await connection.execute(
      `UPDATE deposit_requests SET status = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'PENDING'`,
      [decision, adminId, id],
    );
    await connection.execute(
      `INSERT INTO admin_audit_logs (admin_telegram_id, action, entity_type, entity_id, details)
       VALUES (?, ?, 'DEPOSIT', ?, ?)`,
      [String(adminId), decision, String(id), (reason || `Deposit ${decision.toLowerCase()}`).slice(0, 255)],
    );
    await connection.commit();
    outcome = {
      found: true,
      status: decision,
      changed: true,
      telegramId: String(deposit.telegram_id),
      amount: formatAmount(deposit.amount),
      balanceAfter,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  if (outcome.changed) {
    const user = await getUser(outcome.telegramId);
    const lang = languageOf(user?.language);
    const notice = decision === 'APPROVED'
      ? text[lang].depositApproved(outcome.amount, outcome.balanceAfter)
      : `${text[lang].depositRejected(id)}${reason ? `\nReason: ${reason}` : ''}`;
    try {
      await telegramApi('sendMessage', { chat_id: outcome.telegramId, text: notice });
    } catch (error) {
      console.error(`User notification failed for deposit #${id}:`, error.message);
    }
  }
  return outcome;
}

async function pendingDeposits(limit = 10) {
  await initializeSchema();
  const [rows] = await pool.query(
    `SELECT d.id, d.telegram_id, d.method, d.amount, d.provider_reference, u.first_name, u.username
     FROM deposit_requests d JOIN users u ON u.telegram_id = d.telegram_id
     WHERE d.status = 'PENDING' ORDER BY d.created_at ASC LIMIT ${Number(limit)}`,
  );
  return rows;
}

async function pendingWithdrawals(limit = 10) {
  await initializeSchema();
  const [rows] = await pool.query(
    `SELECT r.id, r.telegram_id, r.amount, r.payout_method, r.payout_details, u.first_name, u.username
     FROM withdrawal_requests r JOIN users u ON u.telegram_id = r.telegram_id
     WHERE r.status = 'PENDING' ORDER BY r.created_at ASC LIMIT ${Number(limit)}`,
  );
  return rows;
}

async function getProfile(telegramId) {
  const user = await getUser(telegramId);
  if (!user) throw new Error('User profile not found.');
  const availableBalance = await getAvailableBalance(telegramId);
  const [[referrals]] = await pool.execute(
    `SELECT COUNT(*) AS total,
       SUM(CASE WHEN status = 'QUALIFIED' THEN 1 ELSE 0 END) AS qualified
     FROM referral_relationships WHERE referrer_telegram_id = ?`,
    [String(telegramId)],
  );
  const [[wins]] = await pool.execute(
    `SELECT COUNT(*) AS total, COALESCE(SUM(amount), 0.00) AS winnings
     FROM wallet_transactions WHERE telegram_id = ? AND type = 'GAME_WIN'`,
    [String(telegramId)],
  );
  return {
    user,
    availableBalance,
    referralCount: Number(referrals.qualified || 0),
    referralInvites: Number(referrals.total || 0),
    gamesWon: Number(wins.total || 0),
    winnings: formatAmount(wins.winnings || '0.00'),
  };
}

async function getWalletHistory(telegramId, limit = 10) {
  const [rows] = await pool.query(
    `SELECT id, type, amount, balance_after, description, created_at
     FROM wallet_transactions WHERE telegram_id = ?
     ORDER BY created_at DESC LIMIT ${Number(limit)}`,
    [String(telegramId)],
  );
  return rows;
}

function walletActionsKeyboard(lang) {
  return {
    inline_keyboard: [
      [{ text: text[lang].deposit, callback_data: 'wallet:deposit' },
        { text: text[lang].withdraw, callback_data: 'wallet:withdraw' }],
      [{ text: '🔄 Refresh balance', callback_data: 'wallet:refresh' }],
    ],
  };
}

async function sendDepositChoices(chatId, lang) {
  if (!config.paymentMethods.length) {
    return telegramApi('sendMessage', { chat_id: chatId, text: text[lang].depositDisabled });
  }
  return telegramApi('sendMessage', {
    chat_id: chatId,
    text: text[lang].choosePaymentMethod,
    reply_markup: {
      inline_keyboard: config.paymentMethods.map((method) => [{
        text: method.label,
        callback_data: `deposit:method:${method.method}`,
      }]).concat([[{ text: '❌ Cancel', callback_data: 'flow:cancel' }]]),
    },
  });
}

async function beginWithdrawal(chatId, telegramId, lang) {
  const available = await getAvailableBalance(telegramId);
  if (decimalToMinorUnits(available) < decimalToMinorUnits(config.withdrawalMinimum)) {
    return telegramApi('sendMessage', {
      chat_id: chatId,
      text: `${text[lang].withdrawalInfo(available, config.withdrawalMinimum)}\n\n${text[lang].minimumWithdrawal(config.withdrawalMinimum)}`,
      reply_markup: keyboardFor(lang),
    });
  }
  await setUserFlow(telegramId, 'withdrawal', 'amount', {
    idempotencyKey: crypto.randomBytes(24).toString('base64url'),
  });
  return telegramApi('sendMessage', {
    chat_id: chatId,
    text: text[lang].withdrawalInfo(available, config.withdrawalMinimum),
    reply_markup: {
      inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'withdraw:cancel' }]],
    },
  });
}

async function getInviteDetails(telegramId) {
  const [code, [[row]]] = await Promise.all([
    ensureReferralCode(telegramId),
    pool.execute(
      `SELECT COUNT(*) AS successful
       FROM referral_relationships WHERE referrer_telegram_id = ? AND status = 'QUALIFIED'`,
      [String(telegramId)],
    ),
  ]);
  if (!config.botUsername) {
    const bot = await telegramApi('getMe');
    config.botUsername = bot.username;
  }
  return {
    url: `https://t.me/${config.botUsername}?start=ref_${code}`,
    count: Number(row.successful || 0),
  };
}

async function sendHistory(chatId, telegramId, lang) {
  const rows = await getWalletHistory(telegramId);
  if (!rows.length) {
    return telegramApi('sendMessage', { chat_id: chatId, text: text[lang].historyEmpty });
  }
  const lines = rows.map((row) => {
    const date = new Date(row.created_at).toISOString().replace('T', ' ').slice(0, 16);
    const sign = ['DEPOSIT', 'GAME_WIN', 'GAME_REFUND', 'REFERRAL_REWARD', 'ADMIN_ADJUSTMENT'].includes(row.type) ? '+' : '-';
    return `${date} · ${row.type} · ${sign}${formatAmount(row.amount)} BIRR · balance ${formatAmount(row.balance_after)} BIRR`;
  });
  return telegramApi('sendMessage', { chat_id: chatId, text: `📜 Wallet history\n\n${lines.join('\n')}` });
}

async function sendProfile(chatId, telegramId, lang) {
  const profile = await getProfile(telegramId);
  const user = profile.user;
  const displayName = [user.first_name, user.last_name].filter(Boolean).join(' ');
  const username = user.username ? `@${user.username}` : 'Not set';
  const message = [
    text[lang].profileTitle,
    '',
    `Name: ${displayName}`,
    `Username: ${username}`,
    `Telegram ID: ${user.telegram_id}`,
    `Available balance: ${profile.availableBalance} BIRR`,
    `Successful referrals: ${profile.referralCount}`,
    `Games played: Not available — game service is not implemented.`,
    `Games won: ${profile.gamesWon}`,
    `Total game winnings: ${profile.winnings} BIRR`,
  ].join('\n');
  return telegramApi('sendMessage', {
    chat_id: chatId,
    text: message,
    reply_markup: {
      inline_keyboard: [[
        { text: text[lang].play, callback_data: 'profile:play' },
        { text: text[lang].history, callback_data: 'profile:history' },
      ]],
    },
  });
}

async function sendPlayEntry(chatId, telegramId, lang) {
  if (config.requireChannelMembership) {
    const membership = await channelMembership(telegramId);
    if (!membership.member) {
      const buttons = [];
      if (config.channelUrl) buttons.push({ text: '📢 Join channel', url: config.channelUrl });
      if (config.channelChatId) buttons.push({ text: '✅ Verify membership', callback_data: 'channel:verify' });
      return telegramApi('sendMessage', {
        chat_id: chatId,
        text: membership.verifiable
          ? text[lang].channelJoin
          : text[lang].channelVerifyUnavailable,
        ...(buttons.length ? { reply_markup: { inline_keyboard: [buttons] } } : {}),
      });
    }
  }
  return telegramApi('sendMessage', {
    chat_id: chatId,
    text: 'Open the Shisho Bingo lobby. Active rooms appear there when the game service is available.',
    reply_markup: {
      inline_keyboard: [[{ text: text[lang].play, web_app: { url: config.appUrl } }]],
    },
  });
}

async function channelMembership(telegramId) {
  if (!config.channelUrl) return { configured: false, member: false };
  if (!config.channelChatId) return { configured: true, member: false, verifiable: false };
  try {
    const member = await telegramApi('getChatMember', {
      chat_id: config.channelChatId,
      user_id: String(telegramId),
    });
    return {
      configured: true,
      verifiable: true,
      member: ['creator', 'administrator', 'member'].includes(member.status) ||
        (member.status === 'restricted' && member.is_member === true),
    };
  } catch (error) {
    console.error('Channel membership check failed:', error.message);
    return { configured: true, verifiable: false };
  }
}

function isMenuText(input, lang) {
  const t = text[lang];
  return [t.play, t.balance, t.profile, t.deposit, t.withdraw, t.invite, t.support, t.channel, t.language]
    .includes(input);
}

async function handleAdminRejectFlow(message, user, lang) {
  const flow = await getUserFlow(user.id);
  if (flow?.flow !== 'admin_reject' || String(user.id) !== config.adminId) return false;
  const reason = String(message.text || '').trim();
  if (/^\/cancel$/i.test(reason)) {
    await clearUserFlow(user.id);
    await telegramApi('sendMessage', {
      chat_id: message.chat.id,
      text: 'Rejection cancelled. The request remains pending.',
      reply_markup: keyboardFor(lang),
    });
    return true;
  }
  if (reason.length < 3 || reason.length > 255 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(reason)) {
    await telegramApi('sendMessage', {
      chat_id: message.chat.id,
      text: 'Please enter a short rejection reason (3–255 characters), or send /cancel.',
    });
    return true;
  }
  const result = flow.data.entity === 'DEPOSIT'
    ? await reviewDeposit(flow.data.id, 'REJECTED', config.adminId, reason)
    : await reviewWithdrawal(flow.data.id, 'REJECTED', config.adminId, reason);
  await clearUserFlow(user.id);
  await telegramApi('sendMessage', {
    chat_id: message.chat.id,
    text: result.changed
      ? `${flow.data.entity} #${flow.data.id} rejected.`
      : result.found
        ? `${flow.data.entity} #${flow.data.id} was already ${result.status.toLowerCase()}.`
        : `${flow.data.entity} #${flow.data.id} was not found.`,
    reply_markup: keyboardFor(lang),
  });
  return true;
}

async function handleUserFlow(message, user, lang) {
  const flow = await getUserFlow(user.id);
  if (!flow) return false;
  const input = String(message.text || '').trim();
  if (/^\/cancel$/i.test(input) || input === '❌ Cancel' || input === '❌ ሰርዝ') {
    await clearUserFlow(user.id);
    await telegramApi('sendMessage', {
      chat_id: message.chat.id,
      text: text[lang].cancelled,
      reply_markup: keyboardFor(lang),
    });
    return true;
  }
  if (isMenuText(input, lang) || /^\/(?:start|play|balance|deposit|withdraw|language|profile|history|invite|support|channel)(?:@\w+)?(?:\s|$)/i.test(input)) {
    await clearUserFlow(user.id);
    return false;
  }

  if (flow.flow === 'deposit' && flow.step === 'amount') {
    const amount = validDepositAmount(input);
    if (!amount) {
      await telegramApi('sendMessage', { chat_id: message.chat.id, text: text[lang].invalidAmount });
      return true;
    }
    await setUserFlow(user.id, 'deposit', 'reference', { method: flow.data.method, amount });
    await telegramApi('sendMessage', { chat_id: message.chat.id, text: text[lang].enterDepositReference });
    return true;
  }
  if (flow.flow === 'deposit' && flow.step === 'reference') {
    let request;
    try {
      request = await createDepositRequest(
        { id: Number(user.id), first_name: user.firstName, username: user.username },
        flow.data.method,
        flow.data.amount,
        input,
      );
    } catch (error) {
      if ([400, 409].includes(error.status)) {
        await telegramApi('sendMessage', { chat_id: message.chat.id, text: error.message });
        return true;
      }
      throw error;
    }
    await clearUserFlow(user.id);
    await telegramApi('sendMessage', {
      chat_id: message.chat.id,
      text: text[lang].depositPending + `\nRequest #${request.id}.` +
        (request.notificationSent ? '' : '\nAdmin notification failed; the request is saved. Ask the admin to use /pendingdeposits.'),
      reply_markup: keyboardFor(lang),
    });
    return true;
  }
  if (flow.flow === 'withdrawal' && flow.step === 'amount') {
    const amount = validDepositAmount(input);
    if (!amount) {
      await telegramApi('sendMessage', { chat_id: message.chat.id, text: text[lang].invalidAmount });
      return true;
    }
    if (decimalToMinorUnits(amount) < decimalToMinorUnits(config.withdrawalMinimum)) {
      await telegramApi('sendMessage', {
        chat_id: message.chat.id,
        text: text[lang].minimumWithdrawal(config.withdrawalMinimum),
      });
      return true;
    }
    const availableBalance = await getAvailableBalance(user.id);
    if (decimalToMinorUnits(amount) > decimalToMinorUnits(availableBalance)) {
      await telegramApi('sendMessage', { chat_id: message.chat.id, text: text[lang].insufficientFunds });
      return true;
    }
    await setUserFlow(user.id, 'withdrawal', 'method', { ...flow.data, amount });
    await telegramApi('sendMessage', {
      chat_id: message.chat.id,
      text: text[lang].withdrawalMethod,
      reply_markup: {
        inline_keyboard: [[
          { text: 'Telebirr', callback_data: 'withdraw:method:TELEBIRR' },
          { text: 'CBE', callback_data: 'withdraw:method:CBE' },
        ], [{ text: '❌ Cancel', callback_data: 'withdraw:cancel' }]],
      },
    });
    return true;
  }
  if (flow.flow === 'withdrawal' && flow.step === 'details') {
    const details = input.slice(0, 191);
    if (details.length < 5 || /[\u0000-\u001f\u007f]/.test(details)) {
      await telegramApi('sendMessage', { chat_id: message.chat.id, text: text[lang].withdrawalDetails });
      return true;
    }
    const data = { ...flow.data, details };
    await setUserFlow(user.id, 'withdrawal', 'confirm', data);
    await telegramApi('sendMessage', {
      chat_id: message.chat.id,
      text: text[lang].withdrawalConfirm(data.amount, data.method, data.details),
      reply_markup: {
        inline_keyboard: [[
          { text: '✅ Confirm request', callback_data: 'withdraw:confirm' },
          { text: '❌ Cancel', callback_data: 'withdraw:cancel' },
        ]],
      },
    });
    return true;
  }
  return false;
}

function verifyInitData(initData) {
  if (typeof initData !== 'string' || initData.length > 8192) {
    throw Object.assign(new Error('Missing or invalid Telegram Mini App credentials.'), { status: 401 });
  }
  const params = new URLSearchParams(initData);
  const receivedHash = params.get('hash');
  const authDate = Number(params.get('auth_date'));
  const userParam = params.get('user');
  if (!receivedHash || !/^[a-f0-9]{64}$/i.test(receivedHash) || !Number.isFinite(authDate) || !userParam) {
    throw Object.assign(new Error('Invalid Telegram Mini App credentials.'), { status: 401 });
  }
  const now = Math.floor(Date.now() / 1000);
  if (authDate > now + 60 || now - authDate > 86400) {
    throw Object.assign(new Error('Telegram Mini App credentials have expired. Reopen the app from Telegram.'), { status: 401 });
  }
  params.delete('hash');
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(config.botToken).digest();
  const expectedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest();
  const actualHash = Buffer.from(receivedHash, 'hex');
  if (actualHash.length !== expectedHash.length || !crypto.timingSafeEqual(actualHash, expectedHash)) {
    throw Object.assign(new Error('Telegram Mini App verification failed.'), { status: 401 });
  }
  let user;
  try {
    user = JSON.parse(userParam);
  } catch {
    throw Object.assign(new Error('Telegram user data is invalid.'), { status: 401 });
  }
  if (!Number.isSafeInteger(user.id) || user.id <= 0) {
    throw Object.assign(new Error('Telegram user ID is invalid.'), { status: 401 });
  }
  return user;
}

function authenticatedTelegramUser(req, res, next) {
  try {
    req.telegramUser = verifyInitData(req.get('Authorization')?.replace(/^tma\s+/i, ''));
    next();
  } catch (error) {
    console.warn(JSON.stringify({
      event: 'telegram_auth_rejected',
      requestId: req.requestId,
      route: req.path,
      code: 'TELEGRAM_AUTH_FAILED',
    }));
    res.status(error.status || 401).json({ error: error.message });
  }
}

function optionalTelegramUser(req, res, next) {
  const authorization = req.get('Authorization');
  if (!authorization) {
    next();
    return;
  }
  try {
    req.telegramUser = verifyInitData(authorization.replace(/^tma\s+/i, ''));
    next();
  } catch (error) {
    res.status(error.status || 401).json({ error: error.message });
  }
}

function adminOnly(req, res, next) {
  if (String(req.telegramUser.id) !== config.adminId) {
    return res.status(403).json({ error: 'Administrator access is required.' });
  }
  next();
}

function shuffle(values) {
  for (let index = values.length - 1; index > 0; index -= 1) {
    const other = crypto.randomInt(index + 1);
    [values[index], values[other]] = [values[other], values[index]];
  }
  return values;
}

function generateCartela() {
  const columns = [];
  for (let column = 0; column < 5; column += 1) {
    const first = column * 15 + 1;
    const values = shuffle(Array.from({ length: 15 }, (_, index) => first + index)).slice(0, 5).sort((a, b) => a - b);
    columns.push(values);
  }
  const card = Array.from({ length: 5 }, (_, row) => columns.flatMap((column) => column[row])).flat();
  card[12] = 'FREE';
  return card;
}

async function ensureOpenRoom(creatorTelegramId = null) {
  await initializeSchema();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute('SELECT id FROM bingo_lobby_lock WHERE id = 1 FOR UPDATE');
    const [available] = await connection.execute(
      `SELECT r.id FROM bingo_rooms r
       WHERE r.status = 'WAITING'
         AND (SELECT COUNT(*) FROM bingo_players p
              WHERE p.room_id = r.id AND p.left_at IS NULL) < r.max_players
       ORDER BY r.created_at ASC
       LIMIT 1`,
    );
    if (available.length) {
      await connection.commit();
      return String(available[0].id);
    }
    const [inserted] = await connection.execute(
      `INSERT INTO bingo_rooms
       (room_number, stake, min_players, max_players, created_by, selection_started_at, selection_deadline)
       VALUES ('pending', ?, ?, ?, ?, CURRENT_TIMESTAMP, DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ${roomCountdownSeconds} SECOND))`,
      [cartelaPrice, roomMinPlayers, roomMaxPlayers, creatorTelegramId ? String(creatorTelegramId) : null],
    );
    const roomId = String(inserted.insertId);
    const slots = Array.from({ length: 100 }, (_, index) => [
      roomId, index + 1, JSON.stringify(generateCartela()),
    ]);
    await connection.query('INSERT INTO cartela_slots (room_id, cartela_number, numbers) VALUES ?', [slots]);
    await connection.execute('UPDATE bingo_rooms SET room_number = ? WHERE id = ?', [roomId, roomId]);
    await connection.commit();
    return roomId;
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}

function parseCartela(value) {
  let parsed = value;
  for (let depth = 0; typeof parsed === 'string' && depth < 3; depth += 1) {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      throw Object.assign(new Error('Stored cartela data is invalid.'), { code: 'INVALID_CARTELA_DATA' });
    }
  }
  if (parsed && !Array.isArray(parsed) && typeof parsed === 'object') {
    if (Array.isArray(parsed.numbers)) parsed = parsed.numbers;
    else if (['B', 'I', 'N', 'G', 'O'].every((letter) => Array.isArray(parsed[letter]) && parsed[letter].length === 5)) {
      parsed = Array.from({ length: 5 }, (_, row) => ['B', 'I', 'N', 'G', 'O'].map((letter) => parsed[letter][row])).flat();
    }
  }
  if (Array.isArray(parsed) && parsed.length === 5 && parsed.every((row) => Array.isArray(row) && row.length === 5)) {
    parsed = parsed.flat();
  }
  const validValues = Array.isArray(parsed) && parsed.length === 25
    && parsed[12] === 'FREE'
    && parsed.every((value, index) => {
      if (index === 12) return true;
      const number = Number(value);
      const column = index % 5;
      return Number.isInteger(number) && number >= column * 15 + 1 && number <= (column + 1) * 15;
    })
    && new Set(parsed.filter((value) => value !== 'FREE').map(Number)).size === 24;
  if (!validValues) {
    throw Object.assign(new Error('Stored cartela data is invalid.'), { code: 'INVALID_CARTELA_DATA' });
  }
  return parsed;
}

async function countValidReservations(connection, roomId) {
  const [reservations] = await connection.execute(
    `SELECT r.telegram_id, s.numbers
     FROM cartela_reservations r
     JOIN cartela_slots s ON s.room_id = r.room_id
       AND s.cartela_number = r.cartela_number
       AND s.owner_telegram_id = r.telegram_id
     JOIN bingo_players p ON p.room_id = r.room_id
       AND p.telegram_id = r.telegram_id AND p.left_at IS NULL
     WHERE r.room_id = ? AND r.status = 'ACTIVE'`,
    [roomId],
  );
  const validPlayers = new Set();
  let validCartelas = 0;
  for (const reservation of reservations) {
    try {
      parseCartela(reservation.numbers);
      validPlayers.add(String(reservation.telegram_id));
      validCartelas += 1;
    } catch (error) {
      if (error.code !== 'INVALID_CARTELA_DATA') throw error;
    }
  }
  return { cartelas: validCartelas, players: validPlayers.size };
}

async function repairRoomCartelas(connection, roomId) {
  const [slots] = await connection.execute(
    `SELECT cartela_number, numbers, owner_telegram_id
     FROM cartela_slots WHERE room_id = ? ORDER BY cartela_number FOR UPDATE`,
    [roomId],
  );
  const [reservations] = await connection.execute(
    `SELECT cartela_number FROM cartela_reservations
     WHERE room_id = ? AND status = 'ACTIVE' FOR UPDATE`,
    [roomId],
  );
  const activeReservations = new Set(reservations.map((row) => Number(row.cartela_number)));
  const present = new Set(slots.map((row) => Number(row.cartela_number)));
  const missing = [];

  for (const slot of slots) {
    let valid = true;
    try {
      parseCartela(slot.numbers);
    } catch (error) {
      if (error.code !== 'INVALID_CARTELA_DATA') throw error;
      valid = false;
    }
    if (valid) continue;
    const number = Number(slot.cartela_number);
    if (slot.owner_telegram_id || activeReservations.has(number)) {
      throw Object.assign(
        new Error(`Cartela #${number} has invalid stored numbers and is owned or reserved; its layout was preserved.`),
        { status: 503, code: 'RESERVED_CARTELA_DATA_INVALID' },
      );
    }
    await connection.execute(
      'UPDATE cartela_slots SET numbers = ? WHERE room_id = ? AND cartela_number = ?',
      [JSON.stringify(generateCartela()), roomId, number],
    );
  }

  for (let number = 1; number <= 100; number += 1) {
    if (!present.has(number)) missing.push([roomId, number, JSON.stringify(generateCartela())]);
  }
  if (missing.length) {
    await connection.query(
      'INSERT INTO cartela_slots (room_id, cartela_number, numbers) VALUES ?',
      [missing],
    );
  }
}

function secureShuffleNumbers() {
  const numbers = Array.from({ length: 75 }, (_, index) => index + 1);
  for (let index = numbers.length - 1; index > 0; index -= 1) {
    const other = crypto.randomInt(index + 1);
    [numbers[index], numbers[other]] = [numbers[other], numbers[index]];
  }
  return numbers;
}

function parseDrawOrder(value, calledNumbers = []) {
  let order = value;
  if (typeof order === 'string') {
    try {
      order = JSON.parse(order);
    } catch {
      throw Object.assign(new Error('Stored game draw order is invalid.'), { status: 503, code: 'INVALID_DRAW_ORDER' });
    }
  }
  if (order == null) {
    const called = calledNumbers.map(Number);
    const remaining = secureShuffleNumbers().filter((number) => !called.includes(number));
    order = [...called, ...remaining];
  }
  if (!Array.isArray(order) || order.length !== 75
    || order.some((number) => !Number.isInteger(Number(number)) || Number(number) < 1 || Number(number) > 75)
    || new Set(order.map(Number)).size !== 75) {
    throw Object.assign(new Error('Stored game draw order is invalid.'), { status: 503, code: 'INVALID_DRAW_ORDER' });
  }
  const normalized = order.map(Number);
  if (calledNumbers.some((number, index) => normalized[index] !== Number(number))) {
    throw Object.assign(new Error('Stored game draw order does not match recorded calls.'), { status: 503, code: 'INVALID_DRAW_ORDER' });
  }
  return normalized;
}

function winningPattern(numbers, calledNumbers) {
  const called = new Set(calledNumbers.map(Number));
  const marked = numbers.map((value) => value === 'FREE' || called.has(Number(value)));
  for (let row = 0; row < 5; row += 1) {
    if (marked.slice(row * 5, row * 5 + 5).every(Boolean)) return `ROW_${row + 1}`;
  }
  for (let column = 0; column < 5; column += 1) {
    if ([0, 1, 2, 3, 4].every((row) => marked[row * 5 + column])) return `COLUMN_${column + 1}`;
  }
  if ([0, 1, 2, 3, 4].every((index) => marked[index * 5 + index])) return 'DIAGONAL_MAIN';
  if ([0, 1, 2, 3, 4].every((index) => marked[index * 5 + 4 - index])) return 'DIAGONAL_ANTI';
  if (marked[0] && marked[4] && marked[20] && marked[24]) return 'FOUR_CORNERS';
  return null;
}

async function settleRoom(connection, roomId, calledNumbers) {
  const [tickets] = await connection.execute(
    `SELECT c.telegram_id, c.cartela_number, s.numbers
     FROM game_claims c
     JOIN cartela_slots s ON s.room_id = c.room_id AND s.cartela_number = c.cartela_number
     JOIN cartela_reservations r ON r.room_id = c.room_id
       AND r.cartela_number = c.cartela_number AND r.telegram_id = c.telegram_id
       AND r.status = 'ACTIVE'
     WHERE c.room_id = ?
     ORDER BY c.cartela_number`,
    [roomId],
  );
  const winners = tickets
    .map((ticket) => ({ ...ticket, pattern: winningPattern(parseCartela(ticket.numbers), calledNumbers) }))
    .filter((ticket) => ticket.pattern);
  if (!winners.length) {
    throw Object.assign(new Error('No valid Bingo claims remain for this room.'), { status: 409, code: 'NO_VALID_CLAIMS' });
  }

  const [[room]] = await connection.execute('SELECT prize_pool FROM bingo_rooms WHERE id = ?', [roomId]);
  const totalPrize = decimalToMinorUnits(room.prize_pool) * 80n / 100n;
  const winnersByPlayer = new Map();
  for (const winner of winners) {
    const playerId = String(winner.telegram_id);
    if (!winnersByPlayer.has(playerId)) winnersByPlayer.set(playerId, []);
    winnersByPlayer.get(playerId).push(winner);
  }
  const playerShare = totalPrize / BigInt(winnersByPlayer.size);
  let playerRemainder = totalPrize % BigInt(winnersByPlayer.size);
  for (const playerWinners of winnersByPlayer.values()) {
    const amountForPlayer = playerShare + (playerRemainder > 0n ? 1n : 0n);
    if (playerRemainder > 0n) playerRemainder -= 1n;
    const cardShare = amountForPlayer / BigInt(playerWinners.length);
    let cardRemainder = amountForPlayer % BigInt(playerWinners.length);
    for (const winner of playerWinners) {
      const prizeCents = cardShare + (cardRemainder > 0n ? 1n : 0n);
      if (cardRemainder > 0n) cardRemainder -= 1n;
      const prize = minorUnitsToDecimal(prizeCents);
      const [[wallet]] = await connection.execute(
        'SELECT balance FROM wallets WHERE telegram_id = ? FOR UPDATE',
        [winner.telegram_id],
      );
      if (!wallet) throw new Error('Winner wallet was not found.');
      const before = decimalToMinorUnits(wallet.balance);
      const after = before + prizeCents;
      await connection.execute('UPDATE wallets SET balance = ? WHERE telegram_id = ?', [
        minorUnitsToDecimal(after), winner.telegram_id,
      ]);
      const [inserted] = await connection.execute(
        `INSERT INTO game_winners (room_id, telegram_id, cartela_number, pattern, prize)
         VALUES (?, ?, ?, ?, ?)`,
        [roomId, winner.telegram_id, winner.cartela_number, winner.pattern, prize],
      );
      await connection.execute(
        `INSERT INTO wallet_transactions
         (telegram_id, type, amount, balance_before, balance_after, reference_id, description)
         VALUES (?, 'GAME_WIN', ?, ?, ?, ?, ?)`,
        [
          winner.telegram_id, prize, minorUnitsToDecimal(before), minorUnitsToDecimal(after),
          String(inserted.insertId), `Bingo win in room #${roomId}`,
        ],
      );
    }
  }
  await connection.execute(
    `UPDATE bingo_rooms SET status = 'FINISHED', finished_at = CURRENT_TIMESTAMP, claim_deadline = NULL WHERE id = ?`,
    [roomId],
  );
  return true;
}

async function roomWinnerResults(executor, roomId) {
  const [winners] = await executor.execute(
    `SELECT w.telegram_id, u.first_name, u.username, w.cartela_number, w.pattern, w.prize, s.numbers
     FROM game_winners w
     JOIN users u ON u.telegram_id = w.telegram_id
     JOIN cartela_slots s ON s.room_id = w.room_id AND s.cartela_number = w.cartela_number
     WHERE w.room_id = ?
     ORDER BY w.id`,
    [roomId],
  );
  return winners.map((winner) => ({
    userId: String(winner.telegram_id),
    name: winner.first_name,
    displayName: winner.first_name,
    username: winner.username,
    cartelaNumber: Number(winner.cartela_number),
    pattern: winner.pattern,
    prize: formatAmount(winner.prize),
    winningGrid: parseCartela(winner.numbers),
  }));
}

async function roomFinishedAt(executor, roomId) {
  const [[result]] = await executor.execute(
    'SELECT UNIX_TIMESTAMP(finished_at) * 1000 AS finished_at_ms FROM bingo_rooms WHERE id = ?',
    [roomId],
  );
  return result?.finished_at_ms == null ? null : Number(result.finished_at_ms);
}

async function advanceRoomGame(roomId) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rooms] = await connection.execute('SELECT * FROM bingo_rooms WHERE id = ? FOR UPDATE', [roomId]);
    const room = rooms[0];
    if (!room || !['PLAYING', 'VERIFYING'].includes(room.status)) {
      await connection.commit();
      return;
    }
    if (room.claim_deadline) {
      const [[claimWindow]] = await connection.execute(
        `SELECT claim_deadline <= CURRENT_TIMESTAMP AS is_due
         FROM bingo_rooms WHERE id = ?`,
        [roomId],
      );
      if (!Number(claimWindow.is_due)) {
        await connection.commit();
        return;
      }
      const [calls] = await connection.execute(
        'SELECT number FROM game_calls WHERE room_id = ? ORDER BY draw_index',
        [roomId],
      );
      await settleRoom(connection, roomId, calls.map((call) => Number(call.number)));
      await connection.commit();
      return;
    }
    const interval = Number(process.env.BINGO_CALL_INTERVAL_SECONDS || 4);
    if (!Number.isInteger(interval) || interval < 1 || interval > 3600) {
      throw new Error('BINGO_CALL_INTERVAL_SECONDS must be an integer from 1 to 3600.');
    }
    const [[elapsed]] = await connection.execute(
      `SELECT GREATEST(0, TIMESTAMPDIFF(MICROSECOND, started_at, CURRENT_TIMESTAMP(3)) / 1000000) AS seconds
       FROM bingo_rooms WHERE id = ?`,
      [roomId],
    );
    const [calls] = await connection.execute(
      'SELECT number FROM game_calls WHERE room_id = ? ORDER BY draw_index',
      [roomId],
    );
    const calledNumbers = calls.map((call) => Number(call.number));
    const drawOrder = parseDrawOrder(room.draw_order, calledNumbers);
    if (room.draw_order == null) {
      await connection.execute('UPDATE bingo_rooms SET draw_order = ? WHERE id = ?', [
        JSON.stringify(drawOrder), roomId,
      ]);
    }
    const targetCallCount = Math.min(75, Math.floor(Number(elapsed.seconds) / interval));
    if (calledNumbers.length >= 75) {
      await connection.execute(
        `UPDATE bingo_rooms SET status = 'FINISHED', finished_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [roomId],
      );
      await connection.commit();
      return;
    }
    for (let drawIndex = calledNumbers.length; drawIndex < targetCallCount; drawIndex += 1) {
      const number = drawOrder[drawIndex];
      await connection.execute(
        'INSERT INTO game_calls (room_id, draw_index, number) VALUES (?, ?, ?)',
        [roomId, drawIndex + 1, number],
      );
      calledNumbers.push(number);
    }
    if (calledNumbers.length > calls.length) {
      await connection.execute('UPDATE bingo_rooms SET last_call_at = CURRENT_TIMESTAMP WHERE id = ?', [roomId]);
    }
    if (calledNumbers.length === 75) {
      await connection.execute(
        `UPDATE bingo_rooms SET status = 'FINISHED', finished_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [roomId],
      );
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function startDueRoom(roomId) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[room]] = await connection.execute(
      `SELECT status, min_players, selection_deadline,
         selection_deadline <= CURRENT_TIMESTAMP AS is_due
       FROM bingo_rooms WHERE id = ? FOR UPDATE`,
      [roomId],
    );
    if (!room || room.status !== 'WAITING' || !Number(room.is_due)) {
      await connection.commit();
      return null;
    }

    const validReservations = await countValidReservations(connection, roomId);
    if (validReservations.cartelas >= Number(room.min_players)) {
      const drawOrder = secureShuffleNumbers();
      await connection.execute(
        `UPDATE bingo_rooms SET status = 'PLAYING', started_at = CURRENT_TIMESTAMP(3),
         last_call_at = CURRENT_TIMESTAMP(3), draw_order = ? WHERE id = ? AND status = 'WAITING'`,
        [JSON.stringify(drawOrder), roomId],
      );
      await connection.commit();
      return 'started';
    }

    await connection.execute(
      `UPDATE bingo_rooms
       SET selection_started_at = CURRENT_TIMESTAMP,
           selection_deadline = DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ${roomCountdownSeconds} SECOND)
       WHERE id = ? AND status = 'WAITING'`,
      [roomId],
    );
    await connection.commit();
    return 'reopened';
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}

async function startDueRooms() {
  await initializeSchema();
  const [rooms] = await pool.execute(
    `SELECT id FROM bingo_rooms
     WHERE status = 'WAITING' AND selection_deadline <= CURRENT_TIMESTAMP
     ORDER BY selection_deadline ASC LIMIT 100`,
  );
  const [verifyingRooms] = await pool.execute(
    `SELECT id FROM bingo_rooms
     WHERE status = 'VERIFYING' AND claim_deadline <= CURRENT_TIMESTAMP
     ORDER BY claim_deadline ASC LIMIT 100`,
  );
  const results = { started: [], reopened: 0 };
  for (const { id } of rooms) {
    const outcome = await startDueRoom(id);
    if (outcome === 'started') {
      const roomId = String(id);
      results.started.push(roomId);
      await advanceRoomGame(roomId);
    } else if (outcome === 'reopened') {
      results.reopened += 1;
    }
  }
  for (const { id } of verifyingRooms) {
    await advanceRoomGame(String(id));
  }
  return results;
}

async function roomSnapshot(roomId, telegramId) {
  const [[room]] = await pool.execute(
    `SELECT *, UNIX_TIMESTAMP(selection_started_at) * 1000 AS selection_started_at_ms,
       UNIX_TIMESTAMP(selection_deadline) * 1000 AS selection_deadline_ms,
       UNIX_TIMESTAMP(started_at) * 1000 AS started_at_ms,
       UNIX_TIMESTAMP(finished_at) * 1000 AS finished_at_ms,
       UNIX_TIMESTAMP(claim_deadline) * 1000 AS claim_deadline_ms,
       GREATEST(0, TIMESTAMPDIFF(SECOND, started_at, CURRENT_TIMESTAMP)) AS game_elapsed_seconds,
       UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3)) * 1000 AS server_now_ms
     FROM bingo_rooms WHERE id = ?`,
    [roomId],
  );
  if (!room) throw Object.assign(new Error('Room not found.'), { status: 404 });
  let [cards] = await pool.execute(
    `SELECT cartela_number, numbers, owner_telegram_id FROM cartela_slots
     WHERE room_id = ? ORDER BY cartela_number`,
    [roomId],
  );
  let hasInvalidCartelas = cards.length !== 100;
  for (const card of cards) {
    try {
      parseCartela(card.numbers);
    } catch (error) {
      if (error.code !== 'INVALID_CARTELA_DATA') throw error;
      hasInvalidCartelas = true;
      break;
    }
  }
  if (hasInvalidCartelas && room.status === 'WAITING') {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [[lockedRoom]] = await connection.execute(
        'SELECT status FROM bingo_rooms WHERE id = ? FOR UPDATE',
        [roomId],
      );
      if (lockedRoom?.status === 'WAITING') await repairRoomCartelas(connection, roomId);
      await connection.commit();
    } catch (error) {
      await connection.rollback().catch(() => {});
      throw error;
    } finally {
      connection.release();
    }
    [cards] = await pool.execute(
      `SELECT cartela_number, numbers, owner_telegram_id FROM cartela_slots
       WHERE room_id = ? ORDER BY cartela_number`,
      [roomId],
    );
  }
  const [calls] = await pool.execute(
    'SELECT number FROM game_calls WHERE room_id = ? ORDER BY draw_index',
    [roomId],
  );
  const [players] = await pool.execute(
    `SELECT COUNT(*) AS count FROM bingo_players
     WHERE room_id = ? AND left_at IS NULL`,
    [roomId],
  );
  const reservationCounts = await countValidReservations(pool, roomId);
  let winners = await roomWinnerResults(pool, roomId);
  const [[selection]] = await pool.execute(
    `SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0.00) AS total_cost
     FROM cartela_reservations
     WHERE room_id = ? AND telegram_id = ? AND status = 'ACTIVE'`,
    [roomId, String(telegramId)],
  );
  const availableBalance = await getAvailableBalance(String(telegramId));
  const calledNumbers = calls.map((call) => Number(call.number));
  const currentNumber = calledNumbers.at(-1) ?? null;
  const configuredInterval = Number(process.env.BINGO_CALL_INTERVAL_SECONDS || 4);
  const cartelas = cards.map((card) => {
    const mine = String(card.owner_telegram_id || '') === String(telegramId);
    const numbers = parseCartela(card.numbers);
    const hits = numbers?.filter((value) => value === 'FREE' || calledNumbers.includes(Number(value))).length || 0;
    return {
      number: Number(card.cartela_number),
      state: mine ? 'MINE' : card.owner_telegram_id ? 'TAKEN' : 'AVAILABLE',
      numbers,
      progress: numbers ? Math.round(hits / 25 * 100) : 0,
    };
  });
  if (room.status !== 'FINISHED') {
    const [[latestStatus]] = await pool.execute(
      `SELECT status, UNIX_TIMESTAMP(finished_at) * 1000 AS finished_at_ms
       FROM bingo_rooms WHERE id = ?`,
      [roomId],
    );
    if (latestStatus) {
      room.status = latestStatus.status;
      room.finished_at_ms = latestStatus.finished_at_ms;
      if (room.status === 'FINISHED') winners = await roomWinnerResults(pool, roomId);
    }
  }
  return {
    room: {
      id: String(room.id),
      roomNumber: room.room_number,
      stake: formatAmount(room.stake),
      minPlayers: Number(room.min_players),
      maxPlayers: Number(room.max_players),
      currentPlayers: Number(players[0].count),
      selectedPlayers: reservationCounts.players,
      selectedCartelas: reservationCounts.cartelas,
      prizePool: formatAmount(room.prize_pool),
      pot: minorUnitsToDecimal(decimalToMinorUnits(room.prize_pool) * 80n / 100n),
      status: room.status,
      countdown: {
        startedAt: Number(room.selection_started_at_ms),
        deadline: Number(room.selection_deadline_ms),
        serverNow: Number(room.server_now_ms),
        durationSeconds: roomCountdownSeconds,
      },
      startedAt: room.started_at_ms == null ? null : Number(room.started_at_ms),
      finishedAt: room.finished_at_ms == null ? null : Number(room.finished_at_ms),
      claimDeadline: room.claim_deadline_ms == null ? null : Number(room.claim_deadline_ms),
      serverNow: Number(room.server_now_ms),
      gameElapsedSeconds: Number(room.game_elapsed_seconds || 0),
      selection: {
        count: Number(selection.count),
        totalCost: formatAmount(selection.total_cost),
        remainingBalance: availableBalance,
      },
      cartelas,
    },
    winner: winners[0] || null,
    winners,
    game: {
      status: room.status,
      calledNumbers,
      currentNumber,
      currentLetter: currentNumber == null ? null : (currentNumber <= 15 ? 'B' : currentNumber <= 30 ? 'I' : currentNumber <= 45 ? 'N' : currentNumber <= 60 ? 'G' : 'O'),
      callIndex: calledNumbers.length,
      serverNow: Number(room.server_now_ms),
      startedAt: room.started_at_ms == null ? null : Number(room.started_at_ms),
      finishedAt: room.finished_at_ms == null ? null : Number(room.finished_at_ms),
      callIntervalSeconds: Number.isInteger(configuredInterval) && configuredInterval >= 1 && configuredInterval <= 3600
        ? configuredInterval : 4,
      callIntervalMs: (Number.isInteger(configuredInterval) && configuredInterval >= 1 && configuredInterval <= 3600
        ? configuredInterval : 4) * 1000,
      drawOrder: parseDrawOrder(room.draw_order, calledNumbers),
      winners,
      recentActivity: calledNumbers.slice(-3).reverse().map((number, index) => ({
        callIndex: calledNumbers.length - index,
        number,
        letter: number <= 15 ? 'B' : number <= 30 ? 'I' : number <= 45 ? 'N' : number <= 60 ? 'G' : 'O',
      })),
    },
  };
}

app.get('/api/cron/rooms', async (req, res, next) => {
  const authorization = req.get('authorization') || '';
  const expected = `Bearer ${config.cronSecret}`;
  const providedBuffer = Buffer.from(authorization);
  const expectedBuffer = Buffer.from(expected);
  if (providedBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(providedBuffer, expectedBuffer)) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }
  try {
    const result = await startDueRooms();
    res.json({ ok: true, ...result });
  } catch (error) {
    next(error);
  }
});

app.get('/health', async (_req, res) => {
  try {
    await initializeSchema();
    await pool.query('SELECT 1');
    res.json({ ok: true, service: 'shisho-bingo', database: 'connected' });
  } catch (error) {
    console.error('Health check failed:', error.message);
    res.status(503).json({ ok: false, service: 'shisho-bingo', database: 'unavailable' });
  }
});

app.get('/api/rooms', optionalTelegramUser, async (req, res, next) => {
  try {
    await initializeSchema();
    if (req.telegramUser) await upsertUser(req.telegramUser);
    await ensureOpenRoom(req.telegramUser ? String(req.telegramUser.id) : null);
    const telegramId = req.telegramUser ? String(req.telegramUser.id) : null;
    const [rooms] = await pool.execute(
      `SELECT r.id, r.room_number, r.stake, r.min_players, r.max_players, r.prize_pool, r.status,
         (SELECT COUNT(*) FROM bingo_players p
          WHERE p.room_id = r.id AND p.left_at IS NULL) AS current_players,
         (SELECT COUNT(*) FROM cartela_reservations cr
          WHERE cr.room_id = r.id AND cr.status = 'ACTIVE') AS selected_cartelas
       FROM bingo_rooms r
       WHERE r.status IN ('WAITING', 'PLAYING', 'VERIFYING')
       ORDER BY (r.status = 'WAITING') DESC, r.created_at DESC
       LIMIT 30`,
      [],
    );
    const myRooms = telegramId
      ? (await pool.execute(
        `SELECT id FROM bingo_rooms r JOIN bingo_players p ON p.room_id = r.id
         WHERE p.telegram_id = ? AND p.left_at IS NULL AND r.status IN ('WAITING', 'PLAYING', 'VERIFYING')
         ORDER BY p.joined_at DESC LIMIT 1`,
        [telegramId],
      ))[0]
      : [];
    res.json({
      myRoom: myRooms[0] ? String(myRooms[0].id) : null,
      rooms: rooms.map((room) => ({
        id: String(room.id),
        roomNumber: room.room_number,
        stake: formatAmount(room.stake),
        minPlayers: Number(room.min_players),
        maxPlayers: Number(room.max_players),
        currentPlayers: Number(room.current_players),
        selectedCartelas: Number(room.selected_cartelas),
        prizePool: formatAmount(room.prize_pool),
        status: room.status,
      })),
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/rooms/:id/join', authenticatedTelegramUser, async (req, res, next) => {
  try {
    await upsertUser(req.telegramUser);
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rooms] = await connection.execute('SELECT * FROM bingo_rooms WHERE id = ? FOR UPDATE', [req.params.id]);
      const room = rooms[0];
      if (!room) throw Object.assign(new Error('Room not found.'), { status: 404 });
      if (['PLAYING', 'VERIFYING', 'FINISHED'].includes(room.status)) {
        await connection.commit();
      } else if (room.status !== 'WAITING') {
        throw Object.assign(new Error('This room is no longer available.'), { status: 409 });
      } else {
        await repairRoomCartelas(connection, room.id);
        const [existing] = await connection.execute(
          'SELECT left_at FROM bingo_players WHERE room_id = ? AND telegram_id = ? FOR UPDATE',
          [room.id, String(req.telegramUser.id)],
        );
        if (!existing.length || existing[0].left_at) {
          const [[count]] = await connection.execute(
            'SELECT COUNT(*) AS count FROM bingo_players WHERE room_id = ? AND left_at IS NULL',
            [room.id],
          );
          if (Number(count.count) >= Number(room.max_players)) {
            throw Object.assign(new Error('This room is full.'), { status: 409 });
          }
        }
        await connection.execute(
          `INSERT INTO bingo_players (room_id, telegram_id) VALUES (?, ?)
           ON DUPLICATE KEY UPDATE joined_at = CURRENT_TIMESTAMP, left_at = NULL`,
          [room.id, String(req.telegramUser.id)],
        );
        await connection.commit();
      }
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    const state = await roomSnapshot(req.params.id, req.telegramUser.id);
    state.wallet = { availableBalance: await getAvailableBalance(String(req.telegramUser.id)) };
    const [membership] = await pool.execute(
      'SELECT 1 FROM bingo_players WHERE room_id = ? AND telegram_id = ? AND left_at IS NULL',
      [req.params.id, String(req.telegramUser.id)],
    );
    state.spectator = ['PLAYING', 'VERIFYING', 'FINISHED'].includes(state.room.status) && !membership.length;
    res.json({ joined: !state.spectator, ...state });
  } catch (error) {
    next(error);
  }
});

async function getRoomState(req, res, next) {
  try {
    await initializeSchema();
    await startDueRoom(req.params.id);
    await advanceRoomGame(req.params.id);
    const [[room]] = await pool.execute('SELECT status FROM bingo_rooms WHERE id = ?', [req.params.id]);
    if (!room) throw Object.assign(new Error('Room not found.'), { status: 404 });
    const [players] = await pool.execute(
      'SELECT 1 FROM bingo_players WHERE room_id = ? AND telegram_id = ? AND left_at IS NULL',
      [req.params.id, String(req.telegramUser.id)],
    );
    if (!players.length && !['PLAYING', 'VERIFYING', 'FINISHED'].includes(room.status)) {
      throw Object.assign(new Error('Join this room to view its game state.'), { status: 403 });
    }
    const state = await roomSnapshot(req.params.id, req.telegramUser.id);
    state.wallet = { availableBalance: await getAvailableBalance(String(req.telegramUser.id)) };
    state.spectator = !players.length;
    res.json(state);
  } catch (error) {
    next(error);
  }
}

app.get('/api/rooms/:id', authenticatedTelegramUser, getRoomState);
app.get('/api/rooms/:id/state', authenticatedTelegramUser, getRoomState);

app.get('/api/rooms/:id/cartelas', authenticatedTelegramUser, async (req, res, next) => {
  try {
    await initializeSchema();
    const [rows] = await pool.execute(
      `SELECT s.cartela_number, s.owner_telegram_id,
              (SELECT r.telegram_id
               FROM cartela_reservations r
               WHERE r.room_id = s.room_id
                 AND r.cartela_number = s.cartela_number
                 AND r.status = 'ACTIVE'
               ORDER BY r.id DESC
               LIMIT 1) AS reservation_owner
       FROM cartela_slots s
       WHERE s.room_id = ?
       ORDER BY s.cartela_number`,
      [req.params.id],
    );
    if (rows.length !== 100) throw Object.assign(new Error('Room cartelas are unavailable.'), { status: 404 });
    const telegramId = String(req.telegramUser.id);
    res.json({
      cartelas: rows.map((row) => {
        const owner = row.reservation_owner ?? row.owner_telegram_id;
        return {
          number: Number(row.cartela_number),
          state: owner == null ? 'AVAILABLE' : String(owner) === telegramId ? 'MINE' : 'TAKEN',
        };
      }),
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/rooms/:id/cartelas-sync', authenticatedTelegramUser, async (req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  try {
    await initializeSchema();
    const [rows] = await pool.execute(
      `SELECT s.cartela_number, s.owner_telegram_id,
              (SELECT r.telegram_id
               FROM cartela_reservations r
               WHERE r.room_id = s.room_id
                 AND r.cartela_number = s.cartela_number
                 AND r.status = 'ACTIVE'
               ORDER BY r.id DESC
               LIMIT 1) AS reservation_owner
       FROM cartela_slots s
       WHERE s.room_id = ?
       ORDER BY s.cartela_number`,
      [req.params.id],
    );
    if (rows.length !== 100) {
      throw Object.assign(new Error('Room cartelas are unavailable.'), { status: 404 });
    }
    const telegramId = String(req.telegramUser.id);
    res.json({
      cartelas: rows.map((row) => {
        const owner = row.reservation_owner ?? row.owner_telegram_id;
        return {
          number: Number(row.cartela_number),
          state: owner == null ? 'AVAILABLE' : String(owner) === telegramId ? 'MINE' : 'TAKEN',
        };
      }),
      myId: telegramId,
    });
  } catch (error) {
    next(error);
  }
});

async function selectCartelaHandler(req, res, next) {
  const connection = await pool.getConnection();
  let transactionStarted = false;
  try {
    await upsertUser(req.telegramUser);
    await startDueRoom(req.params.id);
    const number = Number(req.params.number);
    if (!Number.isInteger(number) || number < 1 || number > 100) {
      throw Object.assign(new Error('Cartela number must be from 1 to 100.'), { status: 400 });
    }
    await connection.beginTransaction();
    transactionStarted = true;
    const [rooms] = await connection.execute('SELECT * FROM bingo_rooms WHERE id = ? FOR UPDATE', [req.params.id]);
    const room = rooms[0];
    if (!room) throw Object.assign(new Error('Room not found.'), { status: 404 });
    if (room.status !== 'WAITING') throw Object.assign(new Error('Cartelas can only be selected before the game starts.'), { status: 409 });
    const [players] = await connection.execute(
      'SELECT 1 FROM bingo_players WHERE room_id = ? AND telegram_id = ? AND left_at IS NULL',
      [room.id, String(req.telegramUser.id)],
    );
    if (!players.length) throw Object.assign(new Error('Join this room before selecting a cartela.'), { status: 403 });
    const [[slot]] = await connection.execute(
      'SELECT owner_telegram_id FROM cartela_slots WHERE room_id = ? AND cartela_number = ? FOR UPDATE',
      [room.id, number],
    );
    if (!slot) throw Object.assign(new Error('Cartela not found.'), { status: 404 });
    if (slot.owner_telegram_id) {
      if (String(slot.owner_telegram_id) === String(req.telegramUser.id)) {
        const [[activeReservation]] = await connection.execute(
          `SELECT id FROM cartela_reservations
           WHERE room_id = ? AND cartela_number = ? AND telegram_id = ? AND status = 'ACTIVE'
           ORDER BY id DESC LIMIT 1`,
          [room.id, number, String(req.telegramUser.id)],
        );
        if (activeReservation) {
          await connection.commit();
          transactionStarted = false;
          res.json({
            selected: true,
            idempotent: true,
            room: (await roomSnapshot(room.id, req.telegramUser.id)).room,
            wallet: { availableBalance: await getAvailableBalance(String(req.telegramUser.id)) },
          });
          return;
        }
      }
      throw Object.assign(new Error('That cartela has already been taken.'), {
        status: 409,
        code: 'CARTELA_TAKEN',
      });
    }
    const [[count]] = await connection.execute(
      `SELECT COUNT(*) AS count FROM cartela_reservations
       WHERE room_id = ? AND telegram_id = ? AND status = 'ACTIVE'`,
      [room.id, String(req.telegramUser.id)],
    );
    if (Number(count.count) >= maxCartelasPerPlayer) {
      throw Object.assign(new Error(`Maximum ${maxCartelasPerPlayer} cartelas allowed per room.`), { status: 400 });
    }
    const [[wallet]] = await connection.execute(
      'SELECT balance FROM wallets WHERE telegram_id = ? FOR UPDATE',
      [String(req.telegramUser.id)],
    );
    if (!wallet) throw new Error('Wallet not found.');
    const available = await getAvailableBalance(String(req.telegramUser.id), connection);
    const cost = decimalToMinorUnits(room.stake);
    if (decimalToMinorUnits(available) < cost) {
      throw Object.assign(
        new Error(`Insufficient balance. You need ${formatAmount(room.stake)} BIRR to select this cartela.`),
        { status: 400, code: 'INSUFFICIENT_BALANCE' },
      );
    }
    const before = decimalToMinorUnits(wallet.balance);
    const after = before - cost;
    const [reservation] = await connection.execute(
      `INSERT INTO cartela_reservations (room_id, cartela_number, telegram_id, amount)
       VALUES (?, ?, ?, ?)`,
      [room.id, number, String(req.telegramUser.id), formatAmount(room.stake)],
    );
    await connection.execute(
      'UPDATE cartela_slots SET owner_telegram_id = ? WHERE room_id = ? AND cartela_number = ?',
      [String(req.telegramUser.id), room.id, number],
    );
    await connection.execute(
      'UPDATE wallets SET balance = ? WHERE telegram_id = ?',
      [minorUnitsToDecimal(after), String(req.telegramUser.id)],
    );
    await connection.execute(
      `INSERT INTO wallet_transactions
       (telegram_id, type, amount, balance_before, balance_after, reference_id, description)
       VALUES (?, 'GAME_ENTRY', ?, ?, ?, ?, ?)`,
      [
        String(req.telegramUser.id), formatAmount(room.stake), minorUnitsToDecimal(before),
        minorUnitsToDecimal(after), String(reservation.insertId), `Cartela #${number} in room #${room.id}`,
      ],
    );
    await connection.execute(
      'UPDATE bingo_rooms SET prize_pool = prize_pool + ? WHERE id = ?',
      [formatAmount(room.stake), room.id],
    );
    await connection.commit();
    transactionStarted = false;
    res.json({
      selected: true,
      room: (await roomSnapshot(room.id, req.telegramUser.id)).room,
      wallet: { availableBalance: await getAvailableBalance(String(req.telegramUser.id)) },
    });
  } catch (error) {
    if (transactionStarted) await connection.rollback().catch(() => {});
    next(error);
  } finally {
    connection.release();
  }
}

app.post('/api/rooms/:id/cartelas/:number/select', authenticatedTelegramUser, selectCartelaHandler);

async function deselectCartelaHandler(req, res, next) {
  const connection = await pool.getConnection();
  try {
    await initializeSchema();
    await startDueRoom(req.params.id);
    const number = Number(req.params.number);
    if (!Number.isInteger(number) || number < 1 || number > 100) {
      throw Object.assign(new Error('Cartela number must be from 1 to 100.'), { status: 400 });
    }
    await connection.beginTransaction();
    const [rooms] = await connection.execute('SELECT * FROM bingo_rooms WHERE id = ? FOR UPDATE', [req.params.id]);
    const room = rooms[0];
    if (!room) throw Object.assign(new Error('Room not found.'), { status: 404 });
    if (room.status !== 'WAITING') throw Object.assign(new Error('Cartelas cannot be changed after the game starts.'), { status: 409 });
    const [[slot]] = await connection.execute(
      `SELECT owner_telegram_id FROM cartela_slots
       WHERE room_id = ? AND cartela_number = ? FOR UPDATE`,
      [room.id, number],
    );
    if (!slot || String(slot.owner_telegram_id || '') !== String(req.telegramUser.id)) {
      throw Object.assign(new Error('You do not own that cartela.'), { status: 404 });
    }
    const [[reservation]] = await connection.execute(
      `SELECT id, amount FROM cartela_reservations
       WHERE room_id = ? AND cartela_number = ? AND telegram_id = ? AND status = 'ACTIVE'
       ORDER BY id DESC LIMIT 1 FOR UPDATE`,
      [room.id, number, String(req.telegramUser.id)],
    );
    const [[wallet]] = await connection.execute(
      'SELECT balance FROM wallets WHERE telegram_id = ? FOR UPDATE',
      [String(req.telegramUser.id)],
    );
    if (!reservation || !wallet) throw new Error('Cartela reservation or wallet was not found.');
    const before = decimalToMinorUnits(wallet.balance);
    const after = before + decimalToMinorUnits(reservation.amount);
    await connection.execute('UPDATE wallets SET balance = ? WHERE telegram_id = ?', [
      minorUnitsToDecimal(after), String(req.telegramUser.id),
    ]);
    await connection.execute(
      `UPDATE cartela_reservations SET status = 'RETURNED', released_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [reservation.id],
    );
    await connection.execute(
      'UPDATE cartela_slots SET owner_telegram_id = NULL WHERE room_id = ? AND cartela_number = ?',
      [room.id, number],
    );
    await connection.execute(
      'UPDATE bingo_rooms SET prize_pool = prize_pool - ? WHERE id = ?',
      [reservation.amount, room.id],
    );
    await connection.execute(
      `INSERT INTO wallet_transactions
       (telegram_id, type, amount, balance_before, balance_after, reference_id, description)
       VALUES (?, 'GAME_REFUND', ?, ?, ?, ?, ?)`,
      [
        String(req.telegramUser.id), reservation.amount, minorUnitsToDecimal(before),
        minorUnitsToDecimal(after), String(reservation.id), `Cartela #${number} returned`,
      ],
    );
    await connection.commit();
    res.json({
      selected: false,
      room: (await roomSnapshot(room.id, req.telegramUser.id)).room,
      wallet: { availableBalance: await getAvailableBalance(String(req.telegramUser.id)) },
    });
  } catch (error) {
    try { await connection.rollback(); } catch { /* The transaction may already be closed. */ }
    next(error);
  } finally {
    connection.release();
  }
}

app.post('/api/rooms/:id/cartelas/:number/deselect', authenticatedTelegramUser, deselectCartelaHandler);

app.post('/api/rooms/:id/cartela', authenticatedTelegramUser, (req, res, next) => {
  const cartelaNumber = Number(req.body?.cartelaNumber);
  const { action } = req.body || {};
  if (!Number.isInteger(cartelaNumber) || cartelaNumber < 1 || cartelaNumber > 100) {
    return next(Object.assign(new Error('Cartela number must be from 1 to 100.'), { status: 400 }));
  }
  if (action !== 'select' && action !== 'deselect') {
    return next(Object.assign(new Error('Cartela action must be select or deselect.'), { status: 400 }));
  }
  req.params.number = String(cartelaNumber);
  return action === 'select'
    ? selectCartelaHandler(req, res, next)
    : deselectCartelaHandler(req, res, next);
});

app.post('/api/rooms/:id/leave', authenticatedTelegramUser, async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    await initializeSchema();
    await connection.beginTransaction();
    const [rooms] = await connection.execute('SELECT * FROM bingo_rooms WHERE id = ? FOR UPDATE', [req.params.id]);
    const room = rooms[0];
    if (!room) throw Object.assign(new Error('Room not found.'), { status: 404 });
    if (room.status !== 'WAITING') throw Object.assign(new Error('You cannot leave after the game starts.'), { status: 409 });
    const [reservations] = await connection.execute(
      `SELECT id, cartela_number, amount FROM cartela_reservations
       WHERE room_id = ? AND telegram_id = ? AND status = 'ACTIVE' FOR UPDATE`,
      [room.id, String(req.telegramUser.id)],
    );
    if (reservations.length) {
      const [[wallet]] = await connection.execute(
        'SELECT balance FROM wallets WHERE telegram_id = ? FOR UPDATE',
        [String(req.telegramUser.id)],
      );
      let balance = decimalToMinorUnits(wallet.balance);
      for (const reservation of reservations) {
        const before = balance;
        balance += decimalToMinorUnits(reservation.amount);
        await connection.execute(
          `UPDATE cartela_reservations SET status = 'RETURNED', released_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [reservation.id],
        );
        await connection.execute(
          'UPDATE cartela_slots SET owner_telegram_id = NULL WHERE room_id = ? AND cartela_number = ?',
          [room.id, reservation.cartela_number],
        );
        await connection.execute(
          `INSERT INTO wallet_transactions
           (telegram_id, type, amount, balance_before, balance_after, reference_id, description)
           VALUES (?, 'GAME_REFUND', ?, ?, ?, ?, ?)`,
          [
            String(req.telegramUser.id), reservation.amount, minorUnitsToDecimal(before),
            minorUnitsToDecimal(balance), String(reservation.id), `Left room #${room.id}`,
          ],
        );
      }
      await connection.execute('UPDATE wallets SET balance = ? WHERE telegram_id = ?', [
        minorUnitsToDecimal(balance), String(req.telegramUser.id),
      ]);
      const refund = reservations.reduce((sum, item) => sum + decimalToMinorUnits(item.amount), 0n);
      await connection.execute('UPDATE bingo_rooms SET prize_pool = prize_pool - ? WHERE id = ?', [
        minorUnitsToDecimal(refund), room.id,
      ]);
    }
    await connection.execute(
      'UPDATE bingo_players SET left_at = CURRENT_TIMESTAMP WHERE room_id = ? AND telegram_id = ?',
      [room.id, String(req.telegramUser.id)],
    );
    await connection.commit();
    res.json({ left: true });
  } catch (error) {
    try { await connection.rollback(); } catch { /* The transaction may already be closed. */ }
    next(error);
  } finally {
    connection.release();
  }
});

app.post('/api/rooms/:id/bingo', authenticatedTelegramUser, async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    await initializeSchema();
    await advanceRoomGame(req.params.id);
    await connection.beginTransaction();
    const [rooms] = await connection.execute('SELECT * FROM bingo_rooms WHERE id = ? FOR UPDATE', [req.params.id]);
    const room = rooms[0];
    if (!room) throw Object.assign(new Error('Room not found.'), { status: 404 });
    if (room.status === 'FINISHED') {
      const winners = await roomWinnerResults(connection, req.params.id);
      const isWinner = winners.some((winner) => winner.userId === String(req.telegramUser.id));
      const finishedAt = await roomFinishedAt(connection, req.params.id);
      const [calls] = await connection.execute(
        'SELECT number FROM game_calls WHERE room_id = ? ORDER BY draw_index',
        [req.params.id],
      );
      await connection.commit();
      if (!isWinner) {
        throw Object.assign(new Error('This game is no longer accepting Bingo claims.'), {
          status: 409,
          code: 'GAME_NOT_PLAYING',
        });
      }
      return res.json({
        success: true,
        bingo: true,
        accepted: true,
        status: 'FINISHED',
        winner: winners[0] || null,
        winners,
        calledNumbers: calls.map((call) => Number(call.number)),
        finishedAt,
      });
    }
    if (!['PLAYING', 'VERIFYING'].includes(room.status)) {
      throw Object.assign(new Error('This game is no longer accepting Bingo claims.'), { status: 409, code: 'GAME_NOT_PLAYING' });
    }
    const [cards] = await connection.execute(
      `SELECT s.cartela_number, s.numbers
       FROM cartela_slots s
       WHERE s.room_id = ? AND s.owner_telegram_id = ?
         AND EXISTS (
           SELECT 1 FROM cartela_reservations r
           WHERE r.room_id = s.room_id
             AND r.cartela_number = s.cartela_number
             AND r.telegram_id = ?
             AND r.status = 'ACTIVE'
         )
       ORDER BY s.cartela_number`,
      [req.params.id, String(req.telegramUser.id), String(req.telegramUser.id)],
    );
    if (!cards.length) {
      throw Object.assign(new Error('You do not have an active reservation for that cartela.'), { status: 403, code: 'CARTELA_NOT_OWNED' });
    }
    const [calls] = await connection.execute(
      'SELECT number FROM game_calls WHERE room_id = ? ORDER BY draw_index',
      [req.params.id],
    );
    const calledNumbers = calls.map((call) => Number(call.number));
    const validClaims = [];
    for (const card of cards) {
      const pattern = winningPattern(parseCartela(card.numbers), calledNumbers);
      if (pattern) validClaims.push({ number: Number(card.cartela_number), pattern });
    }
    if (!validClaims.length) {
      throw Object.assign(new Error('NO_VALID_BINGO'), { status: 400, code: 'NO_VALID_BINGO' });
    }
    for (const claim of validClaims) {
      await connection.execute(
        `INSERT INTO game_claims (room_id, telegram_id, cartela_number, pattern, call_index)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE pattern = VALUES(pattern), call_index = VALUES(call_index)`,
        [req.params.id, String(req.telegramUser.id), claim.number, claim.pattern, calledNumbers.length],
      );
    }
    await settleRoom(connection, req.params.id, calledNumbers);
    const winners = await roomWinnerResults(connection, req.params.id);
    const finishedAt = await roomFinishedAt(connection, req.params.id);
    await connection.commit();
    res.json({
      success: true,
      bingo: true,
      accepted: true,
      status: 'FINISHED',
      winner: winners[0] || null,
      winners,
      calledNumbers,
      finishedAt,
    });
  } catch (error) {
    await connection.rollback().catch(() => {});
    if (error.code === 'NO_VALID_BINGO') {
      return res.status(400).json({ success: false, error: 'NO_VALID_BINGO', code: 'NO_VALID_BINGO' });
    }
    next(error);
  } finally {
    connection.release();
  }
});

app.get('/api/me', authenticatedTelegramUser, async (req, res, next) => {
  try {
    const identity = await upsertUser(req.telegramUser);
    const user = await getUser(identity.id);
    if (!user) throw new Error('Wallet record was not created.');
    const availableBalance = await getAvailableBalance(identity.id);
    res.json({
      user: {
        id: String(user.telegram_id),
        firstName: user.first_name,
        username: user.username,
        language: user.language,
      },
      wallet: { balance: availableBalance, currency: 'BIRR' },
      features: {
        deposits: config.paymentMethods.length > 0,
        withdrawals: true,
        liveGames: true,
        admin: String(req.telegramUser.id) === config.adminId,
      },
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/deposit-options', authenticatedTelegramUser, async (_req, res) => {
  res.json({
    methods: config.paymentMethods.map(({ method, label, account, accountName }) => ({
      method, label, account, accountName,
    })),
  });
});

app.get('/api/profile', authenticatedTelegramUser, async (req, res, next) => {
  try {
    const profile = await getProfile(req.telegramUser.id);
    const [[gameStats]] = await pool.execute(
      `SELECT
         (SELECT COUNT(DISTINCT cr.room_id) FROM cartela_reservations cr
          JOIN bingo_rooms r ON r.id = cr.room_id
          WHERE cr.telegram_id = ? AND r.status IN ('PLAYING', 'FINISHED')) AS played,
         (SELECT COUNT(DISTINCT room_id) FROM game_winners WHERE telegram_id = ?) AS won,
         (SELECT COALESCE(SUM(prize), 0.00) FROM game_winners WHERE telegram_id = ?) AS winnings`,
      [String(req.telegramUser.id), String(req.telegramUser.id), String(req.telegramUser.id)],
    );
    res.json({
      user: {
        id: String(profile.user.telegram_id),
        firstName: profile.user.first_name,
        lastName: profile.user.last_name,
        username: profile.user.username,
        language: profile.user.language,
      },
      wallet: { availableBalance: profile.availableBalance, currency: 'BIRR' },
      referrals: { successful: profile.referralCount, total: profile.referralInvites },
      games: {
        played: Number(gameStats.played),
        won: Number(gameStats.won),
        winnings: formatAmount(gameStats.winnings),
        winRate: Number(gameStats.played)
          ? (Number(gameStats.won) / Number(gameStats.played) * 100).toFixed(1)
          : '0.0',
      },
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/history', authenticatedTelegramUser, async (req, res, next) => {
  try {
    await initializeSchema();
    const transactions = await getWalletHistory(req.telegramUser.id);
    const [games] = await pool.execute(
      `SELECT r.id AS room_id, r.status,
         COALESCE(r.finished_at, r.started_at, r.created_at) AS created_at,
         GROUP_CONCAT(DISTINCT cr.cartela_number ORDER BY cr.cartela_number) AS cartelas,
         COALESCE(SUM(cr.amount), 0.00) AS stake,
         COALESCE((SELECT SUM(w.prize) FROM game_winners w
                   WHERE w.room_id = r.id AND w.telegram_id = ?), 0.00) AS prize,
         (SELECT GROUP_CONCAT(DISTINCT w.pattern ORDER BY w.pattern)
          FROM game_winners w WHERE w.room_id = r.id AND w.telegram_id = ?) AS patterns
       FROM cartela_reservations cr JOIN bingo_rooms r ON r.id = cr.room_id
       WHERE cr.telegram_id = ? AND r.status IN ('PLAYING', 'FINISHED')
       GROUP BY r.id, r.status, r.finished_at, r.started_at, r.created_at
       ORDER BY created_at DESC LIMIT 100`,
      [String(req.telegramUser.id), String(req.telegramUser.id), String(req.telegramUser.id)],
    );
    res.json({
      games: games.map((row) => ({
        roomId: String(row.room_id),
        status: row.status,
        result: decimalToMinorUnits(row.prize) > 0n ? 'WON' : row.status === 'FINISHED' ? 'PLAYED' : row.status,
        prize: formatAmount(row.prize),
        stake: formatAmount(row.stake),
        pattern: row.patterns || null,
        cartelas: row.cartelas ? row.cartelas.split(',').map(Number) : [],
        createdAt: row.created_at,
      })),
      transactions: transactions.map((row) => ({
        id: String(row.id),
        type: row.type,
        amount: formatAmount(row.amount),
        balanceAfter: formatAmount(row.balance_after),
        description: row.description,
        createdAt: row.created_at,
      })),
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/ranks', authenticatedTelegramUser, async (_req, res, next) => {
  try {
    await initializeSchema();
    const [ranks] = await pool.execute(
      `SELECT w.telegram_id, u.first_name, COUNT(DISTINCT w.room_id) AS games_won,
         SUM(w.prize) AS winnings
       FROM game_winners w JOIN users u ON u.telegram_id = w.telegram_id
       GROUP BY w.telegram_id, u.first_name
       ORDER BY winnings DESC, games_won DESC, MIN(w.created_at) ASC LIMIT 100`,
    );
    res.json({
      ranks: ranks.map((rank, index) => ({
        rank: index + 1,
        userId: String(rank.telegram_id),
        displayName: rank.first_name,
        gamesWon: Number(rank.games_won),
        winnings: formatAmount(rank.winnings),
      })),
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/referrals', authenticatedTelegramUser, async (req, res, next) => {
  try {
    const invite = await getInviteDetails(req.telegramUser.id);
    res.json({ referralUrl: invite.url, successful: invite.count });
  } catch (error) {
    next(error);
  }
});

app.get('/api/app-info', authenticatedTelegramUser, (_req, res) => {
  res.json({
    supportUrl: config.supportUrl || (config.supportUsername ? `https://t.me/${config.supportUsername}` : ''),
    channelUrl: config.channelUrl,
  });
});

app.post('/api/deposits', authenticatedTelegramUser, async (req, res, next) => {
  try {
    const request = await createDepositRequest(
      req.telegramUser,
      req.body?.method,
      req.body?.amount,
      req.body?.providerReference,
    );
    res.status(201).json({
      request: { id: request.id, status: 'PENDING', amount: request.amount, method: request.method },
      adminNotified: request.notificationSent,
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/withdrawals', authenticatedTelegramUser, async (req, res, next) => {
  try {
    await upsertUser(req.telegramUser);
    const request = await createWithdrawalRequest(
      String(req.telegramUser.id),
      req.body?.amount,
      req.body?.method,
      req.body?.payoutDetails,
      req.body?.idempotencyKey,
    );
    res.status(request.duplicate ? 200 : 201).json({
      request: { id: request.id, status: 'PENDING', amount: request.amount, method: request.method },
      adminNotified: request.notificationSent,
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/language', authenticatedTelegramUser, async (req, res, next) => {
  try {
    if (!['en', 'am'].includes(req.body?.language)) {
      return res.status(400).json({ error: 'Language must be en or am.' });
    }
    await upsertUser(req.telegramUser);
    await pool.execute('UPDATE users SET language = ? WHERE telegram_id = ?', [req.body.language, String(req.telegramUser.id)]);
    res.json({ language: req.body.language });
  } catch (error) {
    next(error);
  }
});

app.post('/admin/setup', async (req, res, next) => {
  try {
    const supplied = req.get('X-Setup-Secret') || '';
    const expected = Buffer.from(config.setupSecret);
    const actual = Buffer.from(supplied);
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
      return res.status(401).json({ error: 'Unauthorized.' });
    }
    const webhookUrl = `${config.publicUrl}/telegram/webhook`;
    let step = 'setWebhook';
    try {
      await telegramApi(step, {
        url: webhookUrl,
        secret_token: config.webhookSecret,
        allowed_updates: ['message', 'callback_query'],
        drop_pending_updates: false,
      });
      step = 'setChatMenuButton';
      await telegramApi(step, {
        menu_button: {
          type: 'web_app',
          text: 'SHISHO BINGO',
          web_app: { url: config.appUrl },
        },
      });
      step = 'setMyCommands';
      await telegramApi(step, {
        commands: [
          { command: 'start', description: 'Open SHISHO BINGO' },
          { command: 'play', description: 'Open the Bingo Mini App' },
          { command: 'balance', description: 'View your wallet balance' },
          { command: 'deposit', description: 'Submit a deposit for approval' },
          { command: 'withdraw', description: 'Request a withdrawal' },
          { command: 'profile', description: 'View your profile' },
          { command: 'history', description: 'View wallet history' },
          { command: 'invite', description: 'Invite friends' },
          { command: 'support', description: 'Contact support' },
          { command: 'channel', description: 'Join the official channel' },
          { command: 'language', description: 'Change language' },
        ],
      });
      step = 'setAdminCommands';
      await telegramApi(step, {
        scope: { type: 'chat', chat_id: config.adminId },
        commands: [
          { command: 'start', description: 'Open SHISHO BINGO' },
          { command: 'play', description: 'Open the Bingo Mini App' },
          { command: 'balance', description: 'View your wallet balance' },
          { command: 'deposit', description: 'Submit a deposit for approval' },
          { command: 'withdraw', description: 'Request a withdrawal' },
          { command: 'profile', description: 'View your profile' },
          { command: 'history', description: 'View wallet history' },
          { command: 'invite', description: 'Invite friends' },
          { command: 'support', description: 'Contact support' },
          { command: 'channel', description: 'Join the official channel' },
          { command: 'pendingdeposits', description: 'Review pending deposits' },
          { command: 'pendingwithdrawals', description: 'Review pending withdrawals' },
          { command: 'language', description: 'Change language' },
        ],
      });
    } catch (error) {
      console.error(`Telegram setup failed during ${step}:`, error.message);
      return res.status(502).json({
        error: `Telegram setup failed during ${step}.`,
        detail: error.message,
      });
    }
    res.json({ ok: true, webhook: webhookUrl, menuButton: 'configured' });
  } catch (error) {
    next(error);
  }
});

app.post('/telegram/webhook', async (req, res, next) => {
  if (req.get('X-Telegram-Bot-Api-Secret-Token') !== config.webhookSecret) {
    return res.sendStatus(401);
  }
  try {
    const update = req.body || {};
    if (update.callback_query) {
      const callback = update.callback_query;
      const match = /^lang:(en|am)$/.exec(callback.data || '');
      if (match) {
        const user = await upsertUser(callback.from);
        await pool.execute('UPDATE users SET language = ? WHERE telegram_id = ?', [match[1], user.id]);
        await telegramApi('answerCallbackQuery', { callback_query_id: callback.id, text: text[match[1]].languageSaved });
        await telegramApi('sendMessage', {
          chat_id: callback.message.chat.id,
          text: text[match[1]].languageSaved,
          reply_markup: keyboardFor(match[1]),
        });
      } else {
        const data = String(callback.data || '');
        const user = await upsertUser(callback.from);
        const savedUser = await getUser(user.id);
        const lang = languageOf(savedUser?.language);
        const depositReview = /^deposit:(approve|reject):(\d+)$/.exec(data);
        const withdrawalReview = /^withdraw:(approve|reject):(\d+)$/.exec(data);
        const depositMethod = /^deposit:method:(TELEBIRR|CBE)$/.exec(data);
        const withdrawalMethod = /^withdraw:method:(TELEBIRR|CBE)$/.exec(data);
        const supportTopic = /^help:(deposits|withdrawals|wallet|cartela|rules|technical)$/.exec(data);

        if (depositMethod) {
          const option = config.paymentMethods.find((item) => item.method === depositMethod[1]);
          if (!option) {
            await telegramApi('answerCallbackQuery', {
              callback_query_id: callback.id,
              text: text[lang].depositDisabled,
              show_alert: true,
            });
            return res.sendStatus(200);
          }
          await setUserFlow(user.id, 'deposit', 'amount', { method: option.method });
          await telegramApi('answerCallbackQuery', { callback_query_id: callback.id });
          await telegramApi('sendMessage', {
            chat_id: callback.message.chat.id,
            text: `${option.label}\n${option.accountName}\n${option.account}\n\n${text[lang].enterDepositAmount}`,
            reply_markup: {
              inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'flow:cancel' }]],
            },
          });
        } else if (withdrawalMethod) {
          const flow = await getUserFlow(user.id);
          if (flow?.flow !== 'withdrawal' || flow.step !== 'method') {
            await telegramApi('answerCallbackQuery', { callback_query_id: callback.id, text: 'Start a new withdrawal request.', show_alert: true });
            return res.sendStatus(200);
          }
          await setUserFlow(user.id, 'withdrawal', 'details', { ...flow.data, method: withdrawalMethod[1] });
          await telegramApi('answerCallbackQuery', { callback_query_id: callback.id });
          await telegramApi('sendMessage', {
            chat_id: callback.message.chat.id,
            text: text[lang].withdrawalDetails,
            reply_markup: {
              inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'withdraw:cancel' }]],
            },
          });
        } else if (data === 'flow:cancel' || data === 'withdraw:cancel') {
          await clearUserFlow(user.id);
          await telegramApi('answerCallbackQuery', { callback_query_id: callback.id, text: text[lang].cancelled });
          await telegramApi('sendMessage', {
            chat_id: callback.message.chat.id,
            text: text[lang].cancelled,
            reply_markup: keyboardFor(lang),
          });
        } else if (data === 'withdraw:confirm') {
          const flow = await getUserFlow(user.id);
          if (flow?.flow !== 'withdrawal' || flow.step !== 'confirm') {
            await telegramApi('answerCallbackQuery', { callback_query_id: callback.id, text: 'Start a new withdrawal request.', show_alert: true });
            return res.sendStatus(200);
          }
          const request = await createWithdrawalRequest(
            user.id,
            flow.data.amount,
            flow.data.method,
            flow.data.details,
            flow.data.idempotencyKey,
          );
          await clearUserFlow(user.id);
          await telegramApi('answerCallbackQuery', { callback_query_id: callback.id, text: `Request #${request.id} submitted.` });
          await telegramApi('sendMessage', {
            chat_id: callback.message.chat.id,
            text: text[lang].withdrawalPending(request.id) +
              (request.notificationSent ? '' : '\nAdmin notification failed; the request is saved. Ask the admin to use /pendingwithdrawals.'),
            reply_markup: keyboardFor(lang),
          });
        } else if (supportTopic) {
          const topic = supportTopic[1];
          const topicText = {
            deposits: 'Deposit help: check payment instructions and submit the transaction reference. Pending requests require admin approval.',
            withdrawals: `Withdrawal help: minimum ${config.withdrawalMinimum} BIRR, no fee. Pending requests reserve funds until reviewed.`,
            wallet: 'Wallet help: use 💰 Balance to refresh the TiDB-backed balance. Contact support if a transaction is missing.',
            cartela: 'Cartela selection is not available until the persistent room and game service is implemented.',
            rules: 'Bingo rooms and game rules are not available yet; no games or prizes are currently offered.',
            technical: 'Technical help: describe the issue and include your Telegram username. Never send passwords, bot tokens, or payment PINs.',
          }[topic];
          const contactUrl = config.supportUrl ||
            (config.supportUsername ? `https://t.me/${config.supportUsername}` : '');
          const contact = config.supportUsername ? `\n\nContact @${config.supportUsername}.` : '';
          await telegramApi('answerCallbackQuery', { callback_query_id: callback.id });
          await telegramApi('sendMessage', {
            chat_id: callback.message.chat.id,
            text: topicText + contact,
            ...(contactUrl ? {
              reply_markup: { inline_keyboard: [[{ text: 'Contact support', url: contactUrl }]] },
            } : {}),
          });
        } else if (data === 'channel:verify') {
          const membership = await channelMembership(user.id);
          const responseText = !membership.configured
            ? text[lang].channelUnavailable
            : membership.member
              ? text[lang].channelVerified
              : membership.verifiable
                ? text[lang].channelNotMember
                : text[lang].channelVerifyUnavailable;
          await telegramApi('answerCallbackQuery', {
            callback_query_id: callback.id,
            text: responseText,
            show_alert: !membership.member,
          });
        } else if (data === 'wallet:refresh') {
          const profile = await getProfile(user.id);
          await telegramApi('answerCallbackQuery', { callback_query_id: callback.id, text: 'Balance refreshed.' });
          await telegramApi('sendMessage', {
            chat_id: callback.message.chat.id,
            text: text[lang].wallet(profile.availableBalance),
            reply_markup: walletActionsKeyboard(lang),
          });
        } else if (data === 'wallet:deposit') {
          await telegramApi('answerCallbackQuery', { callback_query_id: callback.id });
          await sendDepositChoices(callback.message.chat.id, lang);
        } else if (data === 'wallet:withdraw') {
          await telegramApi('answerCallbackQuery', { callback_query_id: callback.id });
          await beginWithdrawal(callback.message.chat.id, user.id, lang);
        } else if (data === 'profile:history') {
          await telegramApi('answerCallbackQuery', { callback_query_id: callback.id });
          await sendHistory(callback.message.chat.id, user.id, lang);
        } else if (data === 'profile:play') {
          await telegramApi('answerCallbackQuery', { callback_query_id: callback.id });
          await sendPlayEntry(callback.message.chat.id, user.id, lang);
        } else if (data === 'invite:share') {
          await telegramApi('answerCallbackQuery', { callback_query_id: callback.id });
          const details = await getInviteDetails(user.id);
          await telegramApi('sendMessage', {
            chat_id: callback.message.chat.id,
            text: `Share this invite link with friends: ${details.url}`,
            reply_markup: {
              inline_keyboard: [[{
                text: '📤 Share invite',
                url: `https://t.me/share/url?url=${encodeURIComponent(details.url)}`,
              }]],
            },
          });
        } else if (depositReview || withdrawalReview) {
          if (String(callback.from.id) !== config.adminId) {
            await telegramApi('answerCallbackQuery', {
              callback_query_id: callback.id,
              text: text[lang].adminOnly,
              show_alert: true,
            });
            return res.sendStatus(200);
          }
          const matchReview = depositReview || withdrawalReview;
          const decision = matchReview[1] === 'approve' ? 'APPROVED' : 'REJECTED';
          if (decision === 'REJECTED') {
            await setUserFlow(user.id, 'admin_reject', 'reason', {
              entity: depositReview ? 'DEPOSIT' : 'WITHDRAWAL',
              id: matchReview[2],
            });
            await telegramApi('answerCallbackQuery', {
              callback_query_id: callback.id,
              text: 'Enter the rejection reason in the admin chat.',
            });
            await telegramApi('sendMessage', {
              chat_id: callback.message.chat.id,
              text: `Enter a rejection reason for ${depositReview ? 'deposit' : 'withdrawal'} #${matchReview[2]}, or send /cancel.`,
            });
            await telegramApi('editMessageReplyMarkup', {
              chat_id: callback.message.chat.id,
              message_id: callback.message.message_id,
              reply_markup: { inline_keyboard: [] },
            });
            return res.sendStatus(200);
          }
          const outcome = depositReview
            ? await reviewDeposit(matchReview[2], decision, config.adminId)
            : await reviewWithdrawal(matchReview[2], decision, config.adminId);
          const answer = !outcome.found ? 'Request not found.'
            : outcome.changed ? `Request ${outcome.status.toLowerCase()}.`
              : `Already ${outcome.status.toLowerCase()}.`;
          await telegramApi('answerCallbackQuery', {
            callback_query_id: callback.id,
            text: answer,
            show_alert: !outcome.changed,
          });
          if (outcome.changed && callback.message) {
            await telegramApi('editMessageReplyMarkup', {
              chat_id: callback.message.chat.id,
              message_id: callback.message.message_id,
              reply_markup: { inline_keyboard: [] },
            });
          }
        } else {
          await telegramApi('answerCallbackQuery', { callback_query_id: callback.id });
          return res.sendStatus(200);
        }
      }
      return res.sendStatus(200);
    }

    const message = update.message;
    if (!message?.from || !message.chat?.id) return res.sendStatus(200);
    const user = await upsertUser(message.from);
    const savedUser = await getUser(user.id);
    const lang = languageOf(savedUser?.language);
    const t = text[lang];
    const input = String(message.text || '').trim();
    const startMatch = /^\/start(?:@\w+)?(?:\s+(.+))?$/i.exec(input);
    if (startMatch?.[1]) await attributeReferral(user.id, startMatch[1]);
    if (await handleAdminRejectFlow(message, user, lang)) return res.sendStatus(200);
    if (await handleUserFlow(message, user, lang)) return res.sendStatus(200);

    if (startMatch) {
      let welcome = t.welcome(user.firstName) + '\n\n' + t.menu;
      if (user.id === config.adminId) welcome += '\n\nAdmin tools: /pendingdeposits and /pendingwithdrawals';
      await telegramApi('sendMessage', {
        chat_id: message.chat.id,
        text: welcome,
        reply_markup: keyboardFor(lang),
      });
    } else if (/^\/play(?:@\w+)?$/i.test(input) || input === t.play) {
      await sendPlayEntry(message.chat.id, user.id, lang);
    } else if (/^\/balance(?:@\w+)?$/i.test(input) || input === t.balance) {
      const profile = await getProfile(user.id);
      await telegramApi('sendMessage', {
        chat_id: message.chat.id,
        text: `💰 YOUR WALLET\n\nAvailable Balance: ${profile.availableBalance} BIRR`,
        reply_markup: walletActionsKeyboard(lang),
      });
    } else if (input === t.profile || /^\/profile(?:@\w+)?$/i.test(input)) {
      await sendProfile(message.chat.id, user.id, lang);
    } else if (input === t.deposit || /^\/deposit(?:@\w+)?$/i.test(input)) {
      await sendDepositChoices(message.chat.id, lang);
    } else if (input === t.withdraw || /^\/withdraw(?:@\w+)?$/i.test(input)) {
      await beginWithdrawal(message.chat.id, user.id, lang);
    } else if (input === t.invite || /^\/invite(?:@\w+)?$/i.test(input)) {
      const invite = await getInviteDetails(user.id);
      await telegramApi('sendMessage', {
        chat_id: message.chat.id,
        text: t.inviteInfo(invite.url, invite.count),
        reply_markup: {
          inline_keyboard: [[
            { text: '📤 Share invite', url: `https://t.me/share/url?url=${encodeURIComponent(invite.url)}` },
            { text: '📋 Copy invite link', copy_text: { text: invite.url } },
          ]],
        },
      });
    } else if (input === t.support || /^\/support(?:@\w+)?$/i.test(input)) {
      await telegramApi('sendMessage', {
        chat_id: message.chat.id,
        text: t.supportPrompt,
        reply_markup: supportKeyboard(lang),
      });
      const contactUrl = config.supportUrl ||
        (config.supportUsername ? `https://t.me/${config.supportUsername}` : '');
      if (contactUrl) {
        await telegramApi('sendMessage', {
          chat_id: message.chat.id,
          text: t.supportInfo,
          reply_markup: { inline_keyboard: [[{ text: 'Contact support', url: contactUrl }]] },
        });
      }
    } else if (input === t.channel || /^\/channel(?:@\w+)?$/i.test(input)) {
      if (!config.channelUrl) {
        await telegramApi('sendMessage', { chat_id: message.chat.id, text: t.channelUnavailable });
      } else {
        const membership = await channelMembership(user.id);
        const buttons = [{ text: '📢 Join channel', url: config.channelUrl }];
        if (config.channelChatId) buttons.push({ text: '✅ Verify membership', callback_data: 'channel:verify' });
        await telegramApi('sendMessage', {
          chat_id: message.chat.id,
          text: membership.member ? t.channelVerified
            : membership.verifiable ? t.channelJoin : `${t.channelJoin}\n\n${t.channelVerifyUnavailable}`,
          reply_markup: { inline_keyboard: [buttons] },
        });
      }
    } else if (/^\/pendingdeposits(?:@\w+)?$/i.test(input)) {
      if (user.id !== config.adminId) {
        await telegramApi('sendMessage', { chat_id: message.chat.id, text: t.adminOnly });
      } else {
        const requests = await pendingDeposits();
        if (!requests.length) {
          await telegramApi('sendMessage', { chat_id: message.chat.id, text: 'There are no pending deposit requests.' });
        } else {
          for (const request of requests) {
            await telegramApi('sendMessage', {
              chat_id: message.chat.id,
              text: [
                '💰 PENDING DEPOSIT',
                `Request: #${request.id}`,
                `User: ${request.first_name}${request.username ? ` (@${request.username})` : ''}`,
                `Telegram ID: ${request.telegram_id}`,
                `Method: ${request.method}`,
                `Amount: ${formatAmount(request.amount)} BIRR`,
                `Transaction ID: ${request.provider_reference}`,
              ].join('\n'),
              reply_markup: depositReviewKeyboard(request.id),
            });
          }
        }
      }
    } else if (/^\/pendingwithdrawals(?:@\w+)?$/i.test(input)) {
      if (user.id !== config.adminId) {
        await telegramApi('sendMessage', { chat_id: message.chat.id, text: t.adminOnly });
      } else {
        const requests = await pendingWithdrawals();
        if (!requests.length) {
          await telegramApi('sendMessage', { chat_id: message.chat.id, text: 'There are no pending withdrawal requests.' });
        } else {
          for (const request of requests) {
            await telegramApi('sendMessage', {
              chat_id: message.chat.id,
              text: [
                '💸 PENDING WITHDRAWAL',
                `Request: #${request.id}`,
                `User: ${request.first_name}${request.username ? ` (@${request.username})` : ''}`,
                `Telegram ID: ${request.telegram_id}`,
                `Amount: ${formatAmount(request.amount)} BIRR`,
                `Payment method: ${request.payout_method}`,
                `Account: ${request.payout_details}`,
                'Complete the external payout before using Confirm paid & approve.',
              ].join('\n'),
              reply_markup: withdrawalReviewKeyboard(request.id),
            });
          }
        }
      }
    } else if (input === t.language || /^\/language(?:@\w+)?$/i.test(input)) {
      await telegramApi('sendMessage', {
        chat_id: message.chat.id,
        text: t.chooseLanguage,
        reply_markup: {
          inline_keyboard: [[
            { text: '🇬🇧 English', callback_data: 'lang:en' },
            { text: '🇪🇹 አማርኛ', callback_data: 'lang:am' },
          ]],
        },
      });
    } else if (input === t.history || /^\/history(?:@\w+)?$/i.test(input)) {
      await sendHistory(message.chat.id, user.id, lang);
    } else if (/^\/cancel$/i.test(input)) {
      await telegramApi('sendMessage', { chat_id: message.chat.id, text: t.cancelled, reply_markup: keyboardFor(lang) });
    } else if (/^\/help(?:@\w+)?$/i.test(input)) {
      await telegramApi('sendMessage', { chat_id: message.chat.id, text: t.menu, reply_markup: keyboardFor(lang) });
    } else {
      await telegramApi('sendMessage', {
        chat_id: message.chat.id,
        text: t.menu,
        reply_markup: keyboardFor(lang),
      });
    }
    res.sendStatus(200);
  } catch (error) {
    next(error);
  }
});

app.get('/', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.type('html').send(reactMiniAppHtml);
});

app.get('/mini-app.js', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.sendFile(path.join(__dirname, 'public', 'mini-app.js'));
});

const setPublicAssetHeaders = (res, filePath) => {
  if (path.extname(filePath).toLowerCase() === '.mp3') {
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Accept-Ranges', 'bytes');
  }
};
app.use('/audio', express.static(path.join(__dirname, 'public', 'audio'), {
  setHeaders: setPublicAssetHeaders,
  maxAge: '1d',
}));
app.use(express.static(path.join(__dirname, 'public'), {
  index: false,
  setHeaders: setPublicAssetHeaders,
}));

app.use((error, _req, res, _next) => {
  console.error(JSON.stringify({
    event: 'request_failed',
    requestId: _req.requestId,
    userId: _req.telegramUser ? String(_req.telegramUser.id) : undefined,
    route: _req.path,
    code: error.code || 'REQUEST_FAILED',
    status: Number.isInteger(error.status) ? error.status : 500,
    message: error.message,
    ...(error.errno ? { errno: error.errno } : {}),
    ...(error.sqlState ? { sqlState: error.sqlState } : {}),
  }));
  if (res.headersSent) return;
  const status = Number.isInteger(error.status) ? error.status : 500;
  res.status(status).json({
    error: status < 500 ? error.message : 'The request could not be completed. Please retry.',
    requestId: _req.requestId,
    ...(error.code ? { code: error.code } : {}),
  });
});

const miniAppHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="theme-color" content="#100c1d">
  <title>SHISHO BINGO</title>
  <script src="https://telegram.org/js/telegram-web-app.js"></script>
  <style>
    :root{color-scheme:dark;--bg:#100c1d;--card:#1b1530;--gold:#f4c84b;--muted:#b5adc8;--line:#32264d}
    *{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(ellipse at 85% -5%,#48266f 0,transparent 38%),linear-gradient(160deg,#100c1d,#171128 65%,#100c1d);color:#fff;font:16px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif}
    main{width:min(100%,620px);margin:auto;padding:calc(20px + env(safe-area-inset-top)) 18px calc(28px + env(safe-area-inset-bottom))}
    header{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:8px 0 22px}.brand{font-size:13px;letter-spacing:.16em;font-weight:800;color:#f7dfa0}.badge{border:1px solid #594523;border-radius:999px;background:#2c2316;padding:9px 13px;color:var(--gold);font-weight:700;font-size:14px;white-space:nowrap}
    .hero{border:1px solid #493769;border-radius:24px;padding:25px 21px;background:linear-gradient(135deg,#39245b,#211936 65%,#251b34);box-shadow:0 18px 48px #07050c80}.eyebrow{font-size:12px;letter-spacing:.18em;color:var(--gold);font-weight:800}.hero h1{font-size:clamp(27px,8vw,40px);line-height:1.1;margin:10px 0}.hero p,.muted{color:var(--muted)}.hero p{margin:8px 0 0}
    .section{margin-top:24px}.section h2{font-size:18px;margin:0 0 12px}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:11px}.tile{min-height:92px;text-align:left;border:1px solid var(--line);border-radius:17px;padding:15px;background:#1a1428;color:#fff;font:inherit;font-weight:700}.tile span{display:block;font-size:23px;margin-bottom:7px}.tile:active,.primary:active{transform:scale(.985)}.primary{width:100%;border:0;border-radius:15px;background:linear-gradient(110deg,#ffdf72,#edb92d);color:#241704;font:inherit;font-weight:800;padding:15px;margin-top:17px;cursor:pointer}
    .panel{border:1px solid var(--line);border-radius:17px;padding:16px;background:#171225}.notice{color:var(--muted);font-size:14px}.error{color:#ffaaaa}.tabs{display:flex;gap:7px;margin-top:22px}.tab{flex:1;border:1px solid var(--line);border-radius:12px;padding:10px 5px;background:#171225;color:#d8d0e6;font:inherit;font-size:13px}.tab.active{border-color:#b08a34;color:var(--gold);background:#282019}.hidden{display:none}.row{display:flex;justify-content:space-between;gap:10px}.retry{margin-top:12px;border:1px solid #705932;border-radius:10px;padding:9px 14px;background:#2a2217;color:var(--gold);font:inherit}label{display:block;margin:12px 0 6px;font-size:14px;color:#e5deef}select,input{width:100%;border:1px solid var(--line);border-radius:11px;padding:12px;background:#100c1d;color:#fff;font:inherit}select:focus,input:focus{outline:2px solid #b08a34}
  </style>
</head>
<body>
<main>
  <header><div class="brand">SHISHO BINGO</div><div class="badge" id="balance">Wallet · …</div></header>
  <section class="hero"><div class="eyebrow" data-i18n="eyebrow">YOUR NEXT GAME STARTS HERE</div><h1 id="greeting">Welcome</h1><p data-i18n="tagline">Play together. Feel the excitement.</p><button class="primary" data-view="play" data-i18n="openBingo">Open Bingo</button></section>
  <nav class="tabs" aria-label="Main navigation">
    <button class="tab active" data-view="play">🎮 <span data-i18n="play">Play</span></button><button class="tab" data-view="wallet">💰 <span data-i18n="wallet">Wallet</span></button><button class="tab" data-view="history">📜 <span data-i18n="history">History</span></button><button class="tab" data-view="profile">👤 <span data-i18n="profile">Profile</span></button>
  </nav>
  <section class="section view" id="play"><h2 data-i18n="gameLobby">Game lobby</h2><div class="panel"><strong data-i18n="noRoomsTitle">Live rooms are not configured yet</strong><p class="notice" data-i18n="noRoomsBody">Rooms and live Bingo will appear here once the persistent game service is set up. No sample rooms are shown.</p></div></section>
  <section class="section view hidden" id="wallet">
    <h2 data-i18n="yourWallet">Your wallet</h2>
    <div class="panel">
      <div class="row"><span data-i18n="availableBalance">Available balance</span><strong id="walletAmount">…</strong></div>
      <p class="notice" data-i18n="walletInfo">Your balance is read from the same TiDB wallet used by the bot.</p>
      <button class="primary" id="retry" data-i18n="retry">Retry wallet</button>
    </div>
    <div class="section panel" id="depositPanel">
      <h2 data-i18n="depositTitle">Add funds</h2>
      <p class="notice" data-i18n="depositInstructions">Make the payment to the account shown below, then enter its transaction reference. Your wallet is credited only after an administrator approves it.</p>
      <p id="depositUnavailable" class="notice hidden" data-i18n="depositUnavailable">Deposits are not configured yet.</p>
      <form id="depositForm" class="hidden">
        <label for="depositMethod" data-i18n="paymentMethod">Payment method</label>
        <select id="depositMethod" required></select>
        <p id="paymentDetails" class="notice panel"></p>
        <label for="depositAmount" data-i18n="depositAmount">Amount (BIRR)</label>
        <input id="depositAmount" inputmode="decimal" autocomplete="off" placeholder="e.g. 100.00" required>
        <label for="depositReference" data-i18n="transactionReference">Transaction/reference ID</label>
        <input id="depositReference" maxlength="128" autocomplete="off" required>
        <button class="primary" id="submitDeposit" type="submit" data-i18n="submitDeposit">Submit for review</button>
      </form>
      <p id="depositResult" class="notice" role="status" aria-live="polite"></p>
    </div>
  </section>
  <section class="section view hidden" id="history"><h2 data-i18n="history">History</h2><div class="panel"><p class="notice" data-i18n="historyInfo">No financial or game history service has been configured.</p></div></section>
  <section class="section view hidden" id="profile"><h2 data-i18n="profile">Profile</h2><div class="panel"><strong id="name">Open this app in Telegram</strong><p class="notice" id="profileDetail">Telegram identity is verified by the backend when launched inside Telegram.</p><div class="grid"><button class="tile" data-language="en"><span>🇬🇧</span>English</button><button class="tile" data-language="am"><span>🇪🇹</span>አማርኛ</button></div></div></section>
  <p id="status" class="notice" role="status" aria-live="polite"></p>
</main>
<script>
(() => {
  const tg = window.Telegram?.WebApp;
  const balance = document.getElementById('balance');
  const amount = document.getElementById('walletAmount');
  const status = document.getElementById('status');
  const depositForm = document.getElementById('depositForm');
  const depositResult = document.getElementById('depositResult');
  const depositSelect = document.getElementById('depositMethod');
  const paymentDetails = document.getElementById('paymentDetails');
  let paymentMethods = [];
  const translations = {
    en: {
      eyebrow: 'YOUR NEXT GAME STARTS HERE', tagline: 'Play together. Feel the excitement.', openBingo: 'Open Bingo',
      play: 'Play', wallet: 'Wallet', history: 'History', profile: 'Profile', gameLobby: 'Game lobby',
      greeting: name => 'Welcome, ' + name,
      noRoomsTitle: 'Live rooms are not configured yet',
      noRoomsBody: 'Rooms and live Bingo will appear here once the persistent game service is set up. No sample rooms are shown.',
      yourWallet: 'Your wallet', availableBalance: 'Available balance',
      walletInfo: 'Your balance is read from the same TiDB wallet used by the bot. Deposits require admin approval. Use the Telegram bot menu for withdrawals.',
      retry: 'Retry wallet', historyInfo: 'No financial or game history service has been configured.',
      depositTitle: 'Add funds',
      depositInstructions: 'Make the payment to the account shown below, then enter its transaction reference. Your wallet is credited only after an administrator approves it.',
      depositUnavailable: 'Deposits are not configured yet.',
      paymentMethod: 'Payment method', depositAmount: 'Amount (BIRR)',
      transactionReference: 'Transaction/reference ID', submitDeposit: 'Submit for review',
      amountPlaceholder: 'e.g. 100.00', referencePlaceholder: 'Enter the reference from your payment',
      accountDetails: (method, name, account) => method + ' · ' + name + ' · ' + account,
      depositSubmitted: id => 'Request #' + id + ' is pending admin review. Your wallet has not been credited yet.',
      depositAdminRetry: ' The request is saved, but admin notification failed. Admin can run /pendingdeposits.',
      depositFailed: 'Could not submit deposit request.',
      loadingOptions: 'Loading payment methods…',
      openInTelegram: 'Open this app in Telegram', identityInfo: 'Telegram identity is verified by the backend when launched inside Telegram.',
      launchPrompt: 'Launch SHISHO BINGO from the Telegram bot to securely load your account.',
      unavailable: 'Wallet unavailable', retryPrompt: ' Use Retry to try again.',
    },
    am: {
      eyebrow: 'ቀጣዩ ጨዋታዎ እዚህ ይጀምራል', tagline: 'አብረው ይጫወቱ። ደስታውን ይለማመዱ።', openBingo: 'ቢንጎን ክፈት',
      play: 'ጨዋታ', wallet: 'የኪስ ቦርሳ', history: 'ታሪክ', profile: 'መገለጫ', gameLobby: 'የጨዋታ ክፍሎች',
      greeting: name => 'እንኳን ደህና መጡ፣ ' + name,
      noRoomsTitle: 'የቀጥታ ጨዋታ ክፍሎች ገና አልተዘጋጁም',
      noRoomsBody: 'የጨዋታ ክፍሎች እና ቢንጎ የሚታዩት የጨዋታ አገልግሎቱ ሲዘጋጅ ነው። የሙከራ ክፍሎች አይታዩም።',
      yourWallet: 'የእርስዎ የኪስ ቦርሳ', availableBalance: 'ያለው ቀሪ ሂሳብ',
      walletInfo: 'ቀሪ ሂሳቡ ቦቱ ከሚጠቀምበት ተመሳሳይ TiDB የኪስ ቦርሳ ይነበባል። ገንዘብ ማስገባት የአስተዳዳሪ ፈቃድ ይፈልጋል። ለማውጣት የቴሌግራም ቦት ሜኑን ይጠቀሙ።',
      retry: 'እንደገና ሞክር', historyInfo: 'የገንዘብ ወይም የጨዋታ ታሪክ አገልግሎት ገና አልተዘጋጀም።',
      depositTitle: 'ገንዘብ ጨምር',
      depositInstructions: 'ከታች ወደሚታየው ሂሳብ ክፍያ ይፈጽሙና የግብይት መለያውን ያስገቡ። አስተዳዳሪ ካጸደቀው በኋላ ብቻ ወደ ኪስ ቦርሳዎ ይጨመራል።',
      depositUnavailable: 'የገንዘብ ማስገባት አገልግሎት ገና አልተዘጋጀም።',
      paymentMethod: 'የክፍያ ዘዴ', depositAmount: 'መጠን (ብር)',
      transactionReference: 'የግብይት መለያ', submitDeposit: 'ለግምገማ ላክ',
      amountPlaceholder: 'ምሳሌ፦ 100.00', referencePlaceholder: 'ከክፍያዎ የግብይት መለያ ያስገቡ',
      accountDetails: (method, name, account) => method + ' · ' + name + ' · ' + account,
      depositSubmitted: id => 'ጥያቄ #' + id + ' የአስተዳዳሪ ግምገማ እየጠበቀ ነው። ገንዘብ ገና ወደ ኪስ ቦርሳዎ አልተጨመረም።',
      depositAdminRetry: ' ማስታወቂያው አልደረሰም፤ አስተዳዳሪው /pendingdeposits ማስኬድ ይችላል።',
      depositFailed: 'የገንዘብ ማስገቢያ ጥያቄውን መላክ አልተቻለም።',
      loadingOptions: 'የክፍያ ዘዴዎች በመጫን ላይ…',
      openInTelegram: 'ይህን አፕ በቴሌግራም ይክፈቱ', identityInfo: 'በቴሌግራም ሲከፈት ማንነትዎ በአገልጋዩ ይረጋገጣል።',
      launchPrompt: 'መለያዎን በደህና ለመክፈት SHISHO BINGOን ከቴሌግራም ቦት ይክፈቱ።',
      unavailable: 'የኪስ ቦርሳው አልተገኘም', retryPrompt: ' እንደገና ለመሞከር ይጫኑ።',
    },
  };
  let currentLanguage = 'en';
  if (tg) { tg.ready(); tg.expand(); }
  function applyLanguage(language) {
    currentLanguage = language === 'am' ? 'am' : 'en';
    const copy = translations[currentLanguage];
    document.documentElement.lang = currentLanguage;
    document.querySelectorAll('[data-i18n]').forEach(element => {
      const value = copy[element.dataset.i18n];
      if (value) element.textContent = value;
    });
    document.getElementById('depositAmount').placeholder = copy.amountPlaceholder;
    document.getElementById('depositReference').placeholder = copy.referencePlaceholder;
    updatePaymentDetails();
    if (document.getElementById('name').textContent === translations.en.openInTelegram ||
        document.getElementById('name').textContent === translations.am.openInTelegram) {
      document.getElementById('name').textContent = copy.openInTelegram;
      document.getElementById('profileDetail').textContent = copy.identityInfo;
    }
  }
  function formatMoney(value) {
    const [whole = '0', fraction = '00'] = String(value).split('.');
    return BigInt(whole).toLocaleString() + '.' + (fraction + '00').slice(0, 2);
  }
  function updatePaymentDetails() {
    const selected = paymentMethods.find(method => method.method === depositSelect.value);
    const copy = translations[currentLanguage];
    paymentDetails.textContent = selected
      ? copy.accountDetails(selected.label, selected.accountName, selected.account)
      : copy.loadingOptions;
  }
  document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => {
    const selected = button.dataset.view;
    document.querySelectorAll('.view').forEach(section => section.classList.toggle('hidden', section.id !== selected));
    document.querySelectorAll('.tab').forEach(tab => tab.classList.toggle('active', tab.dataset.view === selected));
  }));
  async function loadWallet() {
    if (!tg?.initData) {
      balance.textContent = translations[currentLanguage].openInTelegram;
      amount.textContent = translations[currentLanguage].unavailable;
      status.textContent = translations[currentLanguage].launchPrompt;
      return;
    }
    balance.textContent = 'Wallet · loading';
    amount.textContent = 'Loading…';
    status.textContent = '';
    try {
      const response = await fetch('/api/me', { headers: { Authorization: 'tma ' + tg.initData } });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Wallet unavailable');
      const formatted = formatMoney(data.wallet.balance);
      balance.textContent = '💰 ' + formatted + ' BIRR';
      amount.textContent = formatted + ' BIRR';
      document.getElementById('greeting').textContent = translations[data.user.language === 'am' ? 'am' : 'en'].greeting(data.user.firstName);
      document.getElementById('name').textContent = data.user.firstName;
      document.getElementById('profileDetail').textContent = (data.user.username ? '@' + data.user.username + ' · ' : '') + 'Telegram ID ' + data.user.id;
      applyLanguage(data.user.language);
      await loadDepositOptions();
    } catch (error) {
      balance.textContent = translations[currentLanguage].unavailable;
      amount.textContent = 'Unavailable';
      status.textContent = error.message + translations[currentLanguage].retryPrompt;
      status.className = 'notice error';
    }
  }
  async function loadDepositOptions() {
    const unavailable = document.getElementById('depositUnavailable');
    if (!tg?.initData) {
      unavailable.classList.remove('hidden');
      depositForm.classList.add('hidden');
      return;
    }
    try {
      const response = await fetch('/api/deposit-options', { headers: { Authorization: 'tma ' + tg.initData } });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not load payment methods');
      paymentMethods = data.methods;
      depositSelect.replaceChildren();
      for (const method of paymentMethods) {
        const option = document.createElement('option');
        option.value = method.method;
        option.textContent = method.label;
        depositSelect.append(option);
      }
      const enabled = paymentMethods.length > 0;
      depositForm.classList.toggle('hidden', !enabled);
      unavailable.classList.toggle('hidden', enabled);
      if (enabled) updatePaymentDetails();
      else unavailable.textContent = translations[currentLanguage].depositUnavailable;
    } catch (error) {
      depositForm.classList.add('hidden');
      unavailable.classList.remove('hidden');
      unavailable.className = 'notice error';
      unavailable.textContent = error.message;
    }
  }
  depositSelect.addEventListener('change', updatePaymentDetails);
  depositForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (!tg?.initData) return;
    const submit = document.getElementById('submitDeposit');
    submit.disabled = true;
    depositResult.className = 'notice';
    depositResult.textContent = '';
    try {
      const response = await fetch('/api/deposits', {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: 'tma ' + tg.initData },
        body: JSON.stringify({
          method: depositSelect.value,
          amount: document.getElementById('depositAmount').value.trim(),
          providerReference: document.getElementById('depositReference').value.trim(),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || translations[currentLanguage].depositFailed);
      depositResult.textContent = translations[currentLanguage].depositSubmitted(data.request.id) +
        (data.adminNotified ? '' : translations[currentLanguage].depositAdminRetry);
      depositForm.reset();
      updatePaymentDetails();
    } catch (error) {
      depositResult.className = 'notice error';
      depositResult.textContent = error.message;
    } finally {
      submit.disabled = false;
    }
  });
  document.getElementById('retry').addEventListener('click', loadWallet);
  document.querySelectorAll('[data-language]').forEach(button => button.addEventListener('click', async () => {
    if (!tg?.initData) { status.textContent = 'Open this app from Telegram to change your saved language.'; return; }
    try {
      const response = await fetch('/api/language', {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: 'tma ' + tg.initData },
        body: JSON.stringify({ language: button.dataset.language }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not save language');
      applyLanguage(data.language);
      status.className = 'notice';
      status.textContent = data.language === 'am' ? 'ቋንቋው ተቀይሯል።' : 'Language updated.';
    } catch (error) {
      status.className = 'notice error';
      status.textContent = error.message;
    }
  }));
  applyLanguage('en');
  loadWallet();
  if (tg?.initDataUnsafe?.start_param === 'deposit') {
    document.querySelector('[data-view="wallet"]').click();
  }
})();
</script>
</body>
</html>`;

const reactMiniAppHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="theme-color" content="#08030f">
  <meta name="description" content="Play SHISHO BINGO in Telegram.">
  <title>SHISHO BINGO</title>
  <script src="https://telegram.org/js/telegram-web-app.js"></script>
  <script src="/mini-app.js" defer></script>
</head>
<body>
  <div id="root"></div>
</body>
</html>`;

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  initializeSchema().then(() => {
    app.listen(port, () => console.log(`SHISHO BINGO listening on port ${port}`));
  }).catch((error) => {
    console.error('Could not initialize the database:', error.message);
    process.exitCode = 1;
  });
}

module.exports = app;
