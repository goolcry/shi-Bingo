'use strict';

require('dotenv').config();

const crypto = require('node:crypto');
const express = require('express');
const mysql = require('mysql2/promise');

const requiredEnv = ['BOT_TOKEN', 'DATABASE_HOST', 'DATABASE_USER', 'DATABASE_PASSWORD', 'DATABASE_NAME', 'MINI_APP_URL', 'ADMIN_TELEGRAM_ID', 'WEBHOOK_SECRET', 'SETUP_SECRET'];
const missingEnv = requiredEnv.filter((name) => !process.env[name]);
if (missingEnv.length) {
  throw new Error(`Missing required environment variables: ${missingEnv.join(', ')}`);
}
for (const name of ['WEBHOOK_SECRET', 'SETUP_SECRET']) {
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(process.env[name])) {
    throw new Error(`${name} must be a 32-256 character URL-safe secret. Generate one with crypto.randomBytes(32).toString('base64url').`);
  }
}
if (process.env.WEBHOOK_SECRET === process.env.SETUP_SECRET) {
  throw new Error('WEBHOOK_SECRET and SETUP_SECRET must be different values.');
}

const config = {
  botToken: process.env.BOT_TOKEN,
  adminId: String(process.env.ADMIN_TELEGRAM_ID),
  webhookSecret: process.env.WEBHOOK_SECRET,
  setupSecret: process.env.SETUP_SECRET,
  appUrl: process.env.MINI_APP_URL.replace(/\/+$/, ''),
  publicUrl: (process.env.WEBHOOK_BASE_URL || process.env.MINI_APP_URL).replace(/\/+$/, ''),
  supportUsername: (process.env.SUPPORT_USERNAME || '').replace(/^@/, ''),
  channelUrl: process.env.SUPPORT_CHANNEL_URL || '',
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
};

const pool = mysql.createPool({
  host: config.dbHost,
  port: config.dbPort,
  user: config.dbUser,
  password: config.dbPassword,
  database: config.dbName,
  waitForConnections: true,
  connectionLimit: Number(process.env.DATABASE_CONNECTION_LIMIT || 5),
  queueLimit: 0,
  enableKeepAlive: true,
  ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
  decimalNumbers: false,
});

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
    deposit: '➕ Deposit',
    withdraw: '💸 Withdraw',
    invite: '🎁 Invite',
    profile: '👤 Profile',
    history: '📜 History',
    support: '🆘 Support',
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
  },
  am: {
    welcome: (name) => `ወደ SHISHO BINGO እንኳን ደህና መጡ፣ ${name}!`,
    menu: 'ከታች ያለውን ይምረጡ። ሚኒ አፑን ለመክፈት ጨዋታን ይጫኑ።',
    play: '🎮 ጨዋታ',
    balance: '💰 ቀሪ ሂሳብ',
    deposit: '➕ ገንዘብ አስገባ',
    withdraw: '💸 ገንዘብ አውጣ',
    invite: '🎁 ጋብዝ',
    profile: '👤 መገለጫ',
    history: '📜 ታሪክ',
    support: '🆘 ድጋፍ',
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
  },
};

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '256kb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

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
      [{ text: t.balance }, { text: t.deposit }],
      [{ text: t.withdraw }, { text: t.invite }],
      [{ text: t.profile }, { text: t.history }],
      [{ text: t.support }, { text: t.language }],
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
  return { id, firstName, username };
}

async function getUser(id) {
  await initializeSchema();
  const [rows] = await pool.execute(
    `SELECT u.telegram_id, u.username, u.first_name, u.last_name, u.language, w.balance
     FROM users u JOIN wallets w ON w.telegram_id = u.telegram_id
     WHERE u.telegram_id = ? LIMIT 1`,
    [String(id)],
  );
  return rows[0] || null;
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

async function reviewDeposit(id, decision, adminId) {
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
    }
    await connection.execute(
      `UPDATE deposit_requests SET status = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'PENDING'`,
      [decision, adminId, id],
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
    const notice = lang === 'am'
      ? decision === 'APPROVED'
        ? `✅ የገንዘብ ማስገቢያ ጸድቋል።\n${outcome.amount} ብር ወደ ኪስ ቦርሳዎ ተጨምሯል።\nአዲስ ቀሪ ሂሳብ፦ ${outcome.balanceAfter} ብር።`
        : `❌ የገንዘብ ማስገቢያ ጥያቄ #${id} ውድቅ ተደርጓል። ቀሪ ሂሳብዎ አልተቀየረም።`
      : decision === 'APPROVED'
        ? `✅ Deposit approved\n${outcome.amount} BIRR has been added to your wallet.\nNew balance: ${outcome.balanceAfter} BIRR.`
        : `❌ Deposit request #${id} was rejected. Your wallet was not changed.`;
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
    res.status(error.status || 401).json({ error: error.message });
  }
}

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

app.get('/api/me', authenticatedTelegramUser, async (req, res, next) => {
  try {
    const identity = await upsertUser(req.telegramUser);
    const user = await getUser(identity.id);
    if (!user) throw new Error('Wallet record was not created.');
    res.json({
      user: {
        id: String(user.telegram_id),
        firstName: user.first_name,
        username: user.username,
        language: user.language,
      },
      wallet: { balance: String(user.balance), currency: 'BIRR' },
      features: { deposits: config.paymentMethods.length > 0, withdrawals: false, liveGames: false },
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
          { command: 'pendingdeposits', description: 'Admin: review pending deposits' },
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
        await telegramApi('answerCallbackQuery', { callback_query_id: callback.id });
        const user = await upsertUser(callback.from);
        await pool.execute('UPDATE users SET language = ? WHERE telegram_id = ?', [match[1], user.id]);
        await telegramApi('sendMessage', {
          chat_id: callback.message.chat.id,
          text: text[match[1]].languageSaved,
          reply_markup: keyboardFor(match[1]),
        });
      } else {
        const reviewMatch = /^deposit:(approve|reject):(\d+)$/.exec(callback.data || '');
        if (!reviewMatch) {
          await telegramApi('answerCallbackQuery', { callback_query_id: callback.id });
          return res.sendStatus(200);
        }
        if (String(callback.from.id) !== config.adminId) {
          await telegramApi('answerCallbackQuery', {
            callback_query_id: callback.id,
            text: 'Only the configured administrator can review deposits.',
            show_alert: true,
          });
          return res.sendStatus(200);
        }
        const decision = reviewMatch[1] === 'approve' ? 'APPROVED' : 'REJECTED';
        const outcome = await reviewDeposit(reviewMatch[2], decision, config.adminId);
        const answer = !outcome.found ? 'Deposit request not found.'
          : outcome.changed ? `Deposit ${outcome.status.toLowerCase()}.`
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
    let reply = t.menu;
    let extra = { reply_markup: keyboardFor(lang) };

    if (/^\/start(?:@\w+)?(?:\s|$)/i.test(input)) {
      reply = t.welcome(user.firstName) + '\n\n' + t.menu;
      if (user.id === config.adminId) reply += '\n\nAdmin account detected.';
    } else if (/^\/play(?:@\w+)?$/i.test(input) || input === t.play) {
      reply = `${t.menu}\n\n${config.appUrl}`;
      extra = {
        reply_markup: {
          inline_keyboard: [[{ text: t.play, web_app: { url: config.appUrl } }]],
        },
      };
    } else if (/^\/balance(?:@\w+)?$/i.test(input) || input === t.balance) {
      reply = t.wallet(savedUser.balance);
    } else if (/^\/pendingdeposits(?:@\w+)?$/i.test(input)) {
      if (user.id !== config.adminId) {
        reply = 'This command is for the administrator only.';
      } else {
        const requests = await pendingDeposits();
        if (!requests.length) {
          reply = 'There are no pending deposit requests.';
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
          reply = `Sent ${requests.length} pending request(s) for review.`;
        }
      }
    } else if (/^\/language(?:@\w+)?$/i.test(input) || input === t.language) {
      reply = text[lang].chooseLanguage;
      extra = {
        reply_markup: {
          inline_keyboard: [[
            { text: '🇬🇧 English', callback_data: 'lang:en' },
            { text: '🇪🇹 አማርኛ', callback_data: 'lang:am' },
          ]],
        },
      };
    } else if (input === t.deposit || /^\/deposit(?:@\w+)?$/i.test(input)) {
      if (!config.paymentMethods.length) {
        reply = t.depositDisabled;
      } else {
        reply = 'Open the Mini App to submit a deposit request. Your wallet is credited only after admin approval.';
        extra = {
          reply_markup: {
            inline_keyboard: [[{
              text: t.deposit,
              web_app: { url: `${config.appUrl}?startapp=deposit` },
            }]],
          },
        };
      }
    } else if (input === t.withdraw || input === t.history) {
      reply = t.notConfigured;
    } else if (input === t.profile) {
      reply = `${t.profile}\n${user.firstName}${user.username ? ` (@${user.username})` : ''}\nTelegram ID: ${user.id}`;
    } else if (input === t.invite) {
      const [bot] = await telegramApi('getMe');
      reply = `Invite friends with this bot: https://t.me/${bot.username}?start=ref_${user.id}`;
    } else if (input === t.support) {
      reply = config.supportUsername ? `${t.supportInfo} @${config.supportUsername}` : t.supportInfo;
    } else if (/^\/help(?:@\w+)?$/i.test(input)) {
      reply = t.menu;
    }
    await telegramApi('sendMessage', { chat_id: message.chat.id, text: reply, ...extra });
    res.sendStatus(200);
  } catch (error) {
    next(error);
  }
});

app.get('/', (_req, res) => {
  res.type('html').send(miniAppHtml);
});

app.use((error, _req, res, _next) => {
  console.error('Request failed:', error.message);
  if (res.headersSent) return;
  const status = Number.isInteger(error.status) ? error.status : 500;
  res.status(status).json({
    error: status < 500 ? error.message : 'The request could not be completed. Please retry.',
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
      walletInfo: 'Your balance is read from the same TiDB wallet used by the bot. Deposits and withdrawals are not enabled in this starter.',
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
      walletInfo: 'ቀሪ ሂሳቡ ቦቱ ከሚጠቀምበት ተመሳሳይ TiDB የኪስ ቦርሳ ይነበባል። ገንዘብ ማስገባትና ማውጣት ገና አልተከፈተም።',
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
