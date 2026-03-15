const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, 'bot_database.db');
const LEGACY_JSON_FILE = path.join(__dirname, 'bot_data.json');

let NodeSqlite = null;
let BetterSqlite3 = null;
let Sqlite3 = null;

try {
    NodeSqlite = require('node:sqlite');
} catch (_) {}

try {
    BetterSqlite3 = require('better-sqlite3');
} catch (_) {}

try {
    Sqlite3 = require('sqlite3').verbose();
} catch (_) {}

if (!NodeSqlite && !BetterSqlite3 && !Sqlite3) {
    throw new Error('No SQLite driver found. Use Node.js 22+ (node:sqlite) or install better-sqlite3/sqlite3.');
}

class Database {
    constructor() {
        this.statementCache = new Map();

        if (NodeSqlite?.DatabaseSync) {
            this.driver = 'node:sqlite';
            this.db = new NodeSqlite.DatabaseSync(DB_FILE);
            this._configureSyncDb();
            this.initSchemaSync();
            this.migrateLegacyJsonIfNeededSync();
            return;
        }

        if (BetterSqlite3) {
            this.driver = 'better-sqlite3';
            this.db = new BetterSqlite3(DB_FILE);
            this._configureSyncDb();
            this.initSchemaSync();
            this.migrateLegacyJsonIfNeededSync();
            return;
        }

        this.driver = 'sqlite3';
        this.initializing = true;
        this.db = new Sqlite3.Database(DB_FILE, (err) => {
            if (err) {
                console.error('Database connection error:', err.message);
            }
        });
        this.ready = this._initSqlite3().finally(() => {
            this.initializing = false;
        });
    }

    get isSyncDriver() {
        return this.driver === 'node:sqlite' || this.driver === 'better-sqlite3';
    }

    _configureSyncDb() {
        const pragmas = [
            'PRAGMA journal_mode = WAL',
            'PRAGMA synchronous = NORMAL',
            'PRAGMA foreign_keys = ON',
            'PRAGMA temp_store = MEMORY',
            'PRAGMA cache_size = -20000',
            'PRAGMA mmap_size = 268435456',
            'PRAGMA busy_timeout = 5000'
        ];
        for (const pragma of pragmas) {
            try {
                if (this.driver === 'better-sqlite3') {
                    this.db.pragma(pragma.replace(/^PRAGMA\s+/i, ''));
                } else {
                    this.db.exec(pragma);
                }
            } catch (error) {
                console.error('Failed to apply pragma:', pragma, error.message);
            }
        }
    }

    async _initSqlite3() {
        await this.exec('PRAGMA journal_mode = WAL');
        await this.exec('PRAGMA synchronous = NORMAL');
        await this.exec('PRAGMA foreign_keys = ON');
        await this.exec('PRAGMA temp_store = MEMORY');
        await this.exec('PRAGMA cache_size = -20000');
        await this.exec('PRAGMA mmap_size = 268435456');
        await this.exec('PRAGMA busy_timeout = 5000');
        await this.initSchema();
        await this.migrateLegacyJsonIfNeeded();
    }

    _prepare(sql) {
        let stmt = this.statementCache.get(sql);
        if (!stmt) {
            stmt = this.db.prepare(sql);
            this.statementCache.set(sql, stmt);
        }
        return stmt;
    }

    async _ensureReady() {
        if (this.ready && !this.initializing) {
            await this.ready;
        }
    }

    _normalizeParams(params) {
        if (Array.isArray(params)) return params;
        if (params && typeof params === 'object') return params;
        return [];
    }

    _executeSyncStatement(stmt, method, params) {
        const normalized = this._normalizeParams(params);
        if (Array.isArray(normalized)) {
            return stmt[method](...normalized);
        }
        return stmt[method](normalized);
    }

    async run(sql, params = []) {
        if (this.isSyncDriver) {
            const stmt = this._prepare(sql);
            const result = this._executeSyncStatement(stmt, 'run', params);
            return { lastID: Number(result.lastInsertRowid || 0), changes: Number(result.changes || 0) };
        }

        await this._ensureReady();
        return new Promise((resolve, reject) => {
            this.db.run(sql, this._normalizeParams(params), function(error) {
                if (error) reject(error);
                else resolve({ lastID: Number(this.lastID || 0), changes: Number(this.changes || 0) });
            });
        });
    }

    async get(sql, params = []) {
        if (this.isSyncDriver) {
            const stmt = this._prepare(sql);
            return this._executeSyncStatement(stmt, 'get', params) || null;
        }

        await this._ensureReady();
        return new Promise((resolve, reject) => {
            this.db.get(sql, this._normalizeParams(params), (error, row) => {
                if (error) reject(error);
                else resolve(row || null);
            });
        });
    }

    async all(sql, params = []) {
        if (this.isSyncDriver) {
            const stmt = this._prepare(sql);
            return this._executeSyncStatement(stmt, 'all', params);
        }

        await this._ensureReady();
        return new Promise((resolve, reject) => {
            this.db.all(sql, this._normalizeParams(params), (error, rows) => {
                if (error) reject(error);
                else resolve(rows || []);
            });
        });
    }

    async exec(sql) {
        if (this.isSyncDriver) {
            this.db.exec(sql);
            return;
        }

        return new Promise((resolve, reject) => {
            this.db.exec(sql, (error) => {
                if (error) reject(error);
                else resolve();
            });
        });
    }

    initSchemaStatements() {
        return [
            `CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                username TEXT,
                balance REAL DEFAULT 0,
                balance_usd REAL DEFAULT 0,
                preferred_currency TEXT DEFAULT 'EGP',
                preferred_language TEXT DEFAULT 'ar',
                is_banned INTEGER DEFAULT 0,
                referral_code TEXT UNIQUE,
                referred_by TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                last_active TEXT DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (referred_by) REFERENCES users (id)
            )`,
            `CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP
            )`,
            `CREATE TABLE IF NOT EXISTS referrals (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                referrer_id TEXT,
                referred_id TEXT,
                referral_code TEXT,
                reward_earned REAL DEFAULT 0,
                reward_currency TEXT DEFAULT 'EGP',
                status TEXT DEFAULT 'pending',
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                rewarded_at TEXT,
                FOREIGN KEY (referrer_id) REFERENCES users (id),
                FOREIGN KEY (referred_id) REFERENCES users (id)
            )`,
            `CREATE TABLE IF NOT EXISTS available_accounts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT NOT NULL UNIQUE,
                password TEXT,
                first_name TEXT,
                last_name TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )`,
            `CREATE TABLE IF NOT EXISTS active_tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL UNIQUE,
                email TEXT,
                password TEXT,
                first_name TEXT,
                last_name TEXT,
                expires_at TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users (id)
            )`,
            `CREATE TABLE IF NOT EXISTS pending_accounts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT,
                email TEXT,
                password TEXT,
                task_type TEXT DEFAULT 'email',
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users (id)
            )`,
            `CREATE TABLE IF NOT EXISTS gmail_accounts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT,
                email TEXT NOT NULL,
                status TEXT DEFAULT 'pending',
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users (id)
            )`,
            `CREATE TABLE IF NOT EXISTS withdrawal_requests (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT,
                amount REAL,
                currency TEXT DEFAULT 'EGP',
                method TEXT,
                details TEXT,
                status TEXT DEFAULT 'pending',
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                processed_at TEXT,
                FOREIGN KEY (user_id) REFERENCES users (id)
            )`,
            `CREATE TABLE IF NOT EXISTS persistent_export_emails (
                email TEXT PRIMARY KEY,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )`,
            `CREATE TABLE IF NOT EXISTS export_excluded_emails (
                email TEXT PRIMARY KEY,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )`,
            `CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)`,
            `CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at DESC)`,
            `CREATE INDEX IF NOT EXISTS idx_users_last_active ON users(last_active DESC)`,
            `CREATE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code)`,
            `CREATE INDEX IF NOT EXISTS idx_referrals_referrer_id ON referrals(referrer_id)`,
            `CREATE INDEX IF NOT EXISTS idx_referrals_referred_id ON referrals(referred_id)`,
            `CREATE INDEX IF NOT EXISTS idx_referrals_status ON referrals(status)`,
            `CREATE INDEX IF NOT EXISTS idx_referrals_created_at ON referrals(created_at DESC)`,
            `CREATE INDEX IF NOT EXISTS idx_available_accounts_created_at ON available_accounts(created_at DESC)`,
            `CREATE INDEX IF NOT EXISTS idx_active_tasks_user_id ON active_tasks(user_id)`,
            `CREATE INDEX IF NOT EXISTS idx_pending_accounts_created_at ON pending_accounts(created_at DESC)`,
            `CREATE INDEX IF NOT EXISTS idx_pending_accounts_task_type ON pending_accounts(task_type)`,
            `CREATE INDEX IF NOT EXISTS idx_gmail_accounts_status ON gmail_accounts(status)`,
            `CREATE INDEX IF NOT EXISTS idx_gmail_accounts_user_id ON gmail_accounts(user_id)`,
            `CREATE INDEX IF NOT EXISTS idx_gmail_accounts_email ON gmail_accounts(email)`,
            `CREATE INDEX IF NOT EXISTS idx_withdrawal_status ON withdrawal_requests(status)`,
            `CREATE INDEX IF NOT EXISTS idx_withdrawal_created_at ON withdrawal_requests(created_at DESC)`
        ];
    }

    initSchemaSync() {
        for (const sql of this.initSchemaStatements()) {
            this.db.exec(sql);
        }
    }

    async initSchema() {
        for (const sql of this.initSchemaStatements()) {
            await this.exec(sql);
        }
    }

    _now() {
        return new Date().toISOString();
    }

    normalizeEmail(email) {
        return String(email || '').trim().toLowerCase();
    }

    _legacyHasDataSync() {
        if (!fs.existsSync(LEGACY_JSON_FILE)) return false;
        try {
            const raw = fs.readFileSync(LEGACY_JSON_FILE, 'utf8');
            if (!raw.trim()) return false;
            const data = JSON.parse(raw);
            return Object.values(data || {}).some((value) => {
                if (Array.isArray(value)) return value.length > 0;
                if (value && typeof value === 'object') return Object.keys(value).length > 0;
                return Boolean(value);
            });
        } catch (error) {
            console.error('Failed to inspect legacy JSON file:', error.message);
            return false;
        }
    }

    async _legacyHasData() {
        return this._legacyHasDataSync();
    }

    isDatabaseEmptySync() {
        const row = this.db.prepare(`
            SELECT
                (SELECT COUNT(*) FROM users) AS users_count,
                (SELECT COUNT(*) FROM available_accounts) AS available_accounts_count,
                (SELECT COUNT(*) FROM active_tasks) AS active_tasks_count,
                (SELECT COUNT(*) FROM pending_accounts) AS pending_accounts_count,
                (SELECT COUNT(*) FROM gmail_accounts) AS gmail_accounts_count,
                (SELECT COUNT(*) FROM withdrawal_requests) AS withdrawal_requests_count,
                (SELECT COUNT(*) FROM referrals) AS referrals_count,
                (SELECT COUNT(*) FROM settings) AS settings_count,
                (SELECT COUNT(*) FROM persistent_export_emails) AS persistent_count,
                (SELECT COUNT(*) FROM export_excluded_emails) AS excluded_count
        `).get();
        return Object.values(row).every((count) => Number(count) === 0);
    }

    async isDatabaseEmpty() {
        const row = await this.get(`
            SELECT
                (SELECT COUNT(*) FROM users) AS users_count,
                (SELECT COUNT(*) FROM available_accounts) AS available_accounts_count,
                (SELECT COUNT(*) FROM active_tasks) AS active_tasks_count,
                (SELECT COUNT(*) FROM pending_accounts) AS pending_accounts_count,
                (SELECT COUNT(*) FROM gmail_accounts) AS gmail_accounts_count,
                (SELECT COUNT(*) FROM withdrawal_requests) AS withdrawal_requests_count,
                (SELECT COUNT(*) FROM referrals) AS referrals_count,
                (SELECT COUNT(*) FROM settings) AS settings_count,
                (SELECT COUNT(*) FROM persistent_export_emails) AS persistent_count,
                (SELECT COUNT(*) FROM export_excluded_emails) AS excluded_count
        `);
        return Object.values(row || {}).every((count) => Number(count) === 0);
    }

    migrateLegacyJsonIfNeededSync() {
        if (!this._legacyHasDataSync()) return;
        if (!this.isDatabaseEmptySync()) return;

        const raw = fs.readFileSync(LEGACY_JSON_FILE, 'utf8');
        const data = JSON.parse(raw);

        if (this.driver === 'better-sqlite3') {
            const tx = this.db.transaction(() => this._importLegacyDataSync(data));
            tx();
        } else {
            this.db.exec('BEGIN');
            try {
                this._importLegacyDataSync(data);
                this.db.exec('COMMIT');
            } catch (error) {
                this.db.exec('ROLLBACK');
                throw error;
            }
        }

        const backupPath = `${LEGACY_JSON_FILE}.migrated.bak`;
        if (!fs.existsSync(backupPath)) {
            fs.copyFileSync(LEGACY_JSON_FILE, backupPath);
        }
        this.db.prepare(`
            INSERT INTO settings (key, value, updated_at)
            VALUES ('legacy_json_migrated_at', ?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
        `).run(this._now(), this._now());
        console.log('✅ Legacy JSON migrated to SQLite successfully');
    }

    async migrateLegacyJsonIfNeeded() {
        if (!(await this._legacyHasData())) return;
        if (!(await this.isDatabaseEmpty())) return;

        const raw = fs.readFileSync(LEGACY_JSON_FILE, 'utf8');
        const data = JSON.parse(raw);

        await this.exec('BEGIN');
        try {
            await this._importLegacyData(data);
            await this.exec('COMMIT');
        } catch (error) {
            await this.exec('ROLLBACK');
            throw error;
        }

        const backupPath = `${LEGACY_JSON_FILE}.migrated.bak`;
        if (!fs.existsSync(backupPath)) {
            fs.copyFileSync(LEGACY_JSON_FILE, backupPath);
        }
        await this.setSetting('legacy_json_migrated_at', this._now());
        console.log('✅ Legacy JSON migrated to SQLite successfully');
    }

    _importLegacyDataSync(data) {
        const users = Array.isArray(data.users) ? data.users : [];
        const settings = data.settings && typeof data.settings === 'object' ? data.settings : {};
        const referrals = Array.isArray(data.referrals) ? data.referrals : [];
        const availableAccounts = Array.isArray(data.available_accounts) ? data.available_accounts : [];
        const activeTasks = Array.isArray(data.active_tasks) ? data.active_tasks : [];
        const pendingAccounts = Array.isArray(data.pending_accounts) ? data.pending_accounts : [];
        const gmailAccounts = Array.isArray(data.gmail_accounts) ? data.gmail_accounts : [];
        const withdrawalRequests = Array.isArray(data.withdrawal_requests) ? data.withdrawal_requests : [];
        const persistentExportEmails = Array.isArray(data.persistent_export_emails) ? data.persistent_export_emails : [];
        const exportExcludedEmails = Array.isArray(data.export_excluded_emails) ? data.export_excluded_emails : [];

        const insertUser = this._prepare(`
            INSERT INTO users (id, username, balance, balance_usd, preferred_currency, preferred_language, is_banned, referral_code, referred_by, created_at, last_active)
            VALUES (@id, @username, @balance, @balance_usd, @preferred_currency, @preferred_language, @is_banned, @referral_code, @referred_by, @created_at, @last_active)
        `);
        users.forEach((user) => insertUser.run({
            id: String(user.id),
            username: user.username || null,
            balance: Number(user.balance) || 0,
            balance_usd: Number(user.balance_usd) || 0,
            preferred_currency: user.preferred_currency || 'EGP',
            preferred_language: user.preferred_language || 'ar',
            is_banned: Number(user.is_banned) ? 1 : 0,
            referral_code: user.referral_code || null,
            referred_by: user.referred_by || null,
            created_at: user.created_at || this._now(),
            last_active: user.last_active || user.created_at || this._now()
        }));

        const insertSetting = this._prepare(`
            INSERT INTO settings (key, value, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
        `);
        Object.entries(settings).forEach(([key, value]) => {
            if (value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'value')) {
                insertSetting.run(key, String(value.value ?? ''), value.updated_at || this._now());
            } else {
                insertSetting.run(key, String(value ?? ''), this._now());
            }
        });

        const insertReferral = this._prepare(`
            INSERT INTO referrals (id, referrer_id, referred_id, referral_code, reward_earned, reward_currency, status, created_at, rewarded_at)
            VALUES (@id, @referrer_id, @referred_id, @referral_code, @reward_earned, @reward_currency, @status, @created_at, @rewarded_at)
        `);
        referrals.forEach((item) => insertReferral.run({
            id: Number(item.id) || undefined,
            referrer_id: item.referrer_id || null,
            referred_id: item.referred_id || null,
            referral_code: item.referral_code || null,
            reward_earned: Number(item.reward_earned) || 0,
            reward_currency: item.reward_currency || 'EGP',
            status: item.status || 'pending',
            created_at: item.created_at || this._now(),
            rewarded_at: item.rewarded_at || null
        }));

        const insertAvailable = this._prepare(`
            INSERT INTO available_accounts (id, email, password, first_name, last_name, created_at)
            VALUES (@id, @email, @password, @first_name, @last_name, @created_at)
        `);
        availableAccounts.forEach((item) => insertAvailable.run({
            id: Number(item.id) || undefined,
            email: this.normalizeEmail(item.email),
            password: item.password || null,
            first_name: item.first_name || null,
            last_name: item.last_name || null,
            created_at: item.created_at || this._now()
        }));

        const insertTask = this._prepare(`
            INSERT INTO active_tasks (id, user_id, email, password, first_name, last_name, expires_at, created_at)
            VALUES (@id, @user_id, @email, @password, @first_name, @last_name, @expires_at, @created_at)
        `);
        activeTasks.forEach((item) => insertTask.run({
            id: Number(item.id) || undefined,
            user_id: String(item.user_id),
            email: this.normalizeEmail(item.email),
            password: item.password || null,
            first_name: item.first_name || null,
            last_name: item.last_name || null,
            expires_at: item.expires_at || null,
            created_at: item.created_at || this._now()
        }));

        const insertPending = this._prepare(`
            INSERT INTO pending_accounts (id, user_id, email, password, task_type, created_at)
            VALUES (@id, @user_id, @email, @password, @task_type, @created_at)
        `);
        pendingAccounts.forEach((item) => insertPending.run({
            id: Number(item.id) || undefined,
            user_id: String(item.user_id),
            email: this.normalizeEmail(item.email),
            password: item.password || null,
            task_type: item.task_type || 'email',
            created_at: item.created_at || this._now()
        }));

        const insertGmail = this._prepare(`
            INSERT INTO gmail_accounts (id, user_id, email, status, created_at)
            VALUES (@id, @user_id, @email, @status, @created_at)
        `);
        gmailAccounts.forEach((item) => insertGmail.run({
            id: Number(item.id) || undefined,
            user_id: String(item.user_id),
            email: this.normalizeEmail(item.email),
            status: item.status || 'pending',
            created_at: item.created_at || this._now()
        }));

        const insertWithdrawal = this._prepare(`
            INSERT INTO withdrawal_requests (id, user_id, amount, currency, method, details, status, created_at, processed_at)
            VALUES (@id, @user_id, @amount, @currency, @method, @details, @status, @created_at, @processed_at)
        `);
        withdrawalRequests.forEach((item) => insertWithdrawal.run({
            id: Number(item.id) || undefined,
            user_id: String(item.user_id),
            amount: Number(item.amount) || 0,
            currency: item.currency || 'EGP',
            method: item.method || null,
            details: item.details || null,
            status: item.status || 'pending',
            created_at: item.created_at || this._now(),
            processed_at: item.processed_at || null
        }));

        const insertPersistent = this._prepare(`
            INSERT OR IGNORE INTO persistent_export_emails (email, created_at) VALUES (?, ?)
        `);
        persistentExportEmails.forEach((email) => {
            const normalized = this.normalizeEmail(email);
            if (normalized) insertPersistent.run(normalized, this._now());
        });

        const insertExcluded = this._prepare(`
            INSERT OR IGNORE INTO export_excluded_emails (email, created_at) VALUES (?, ?)
        `);
        exportExcludedEmails.forEach((email) => {
            const normalized = this.normalizeEmail(email);
            if (normalized) insertExcluded.run(normalized, this._now());
        });
    }

    async _importLegacyData(data) {
        const users = Array.isArray(data.users) ? data.users : [];
        const settings = data.settings && typeof data.settings === 'object' ? data.settings : {};
        const referrals = Array.isArray(data.referrals) ? data.referrals : [];
        const availableAccounts = Array.isArray(data.available_accounts) ? data.available_accounts : [];
        const activeTasks = Array.isArray(data.active_tasks) ? data.active_tasks : [];
        const pendingAccounts = Array.isArray(data.pending_accounts) ? data.pending_accounts : [];
        const gmailAccounts = Array.isArray(data.gmail_accounts) ? data.gmail_accounts : [];
        const withdrawalRequests = Array.isArray(data.withdrawal_requests) ? data.withdrawal_requests : [];
        const persistentExportEmails = Array.isArray(data.persistent_export_emails) ? data.persistent_export_emails : [];
        const exportExcludedEmails = Array.isArray(data.export_excluded_emails) ? data.export_excluded_emails : [];

        for (const user of users) {
            await this.run(`
                INSERT INTO users (id, username, balance, balance_usd, preferred_currency, preferred_language, is_banned, referral_code, referred_by, created_at, last_active)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                String(user.id),
                user.username || null,
                Number(user.balance) || 0,
                Number(user.balance_usd) || 0,
                user.preferred_currency || 'EGP',
                user.preferred_language || 'ar',
                Number(user.is_banned) ? 1 : 0,
                user.referral_code || null,
                user.referred_by || null,
                user.created_at || this._now(),
                user.last_active || user.created_at || this._now()
            ]);
        }

        for (const [key, value] of Object.entries(settings)) {
            if (value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'value')) {
                await this.run(`
                    INSERT INTO settings (key, value, updated_at)
                    VALUES (?, ?, ?)
                    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
                `, [key, String(value.value ?? ''), value.updated_at || this._now()]);
            } else {
                await this.setSetting(key, String(value ?? ''));
            }
        }

        for (const item of referrals) {
            await this.run(`
                INSERT INTO referrals (id, referrer_id, referred_id, referral_code, reward_earned, reward_currency, status, created_at, rewarded_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                Number(item.id) || null,
                item.referrer_id || null,
                item.referred_id || null,
                item.referral_code || null,
                Number(item.reward_earned) || 0,
                item.reward_currency || 'EGP',
                item.status || 'pending',
                item.created_at || this._now(),
                item.rewarded_at || null
            ]);
        }

        for (const item of availableAccounts) {
            await this.run(`
                INSERT INTO available_accounts (id, email, password, first_name, last_name, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
            `, [
                Number(item.id) || null,
                this.normalizeEmail(item.email),
                item.password || null,
                item.first_name || null,
                item.last_name || null,
                item.created_at || this._now()
            ]);
        }

        for (const item of activeTasks) {
            await this.run(`
                INSERT INTO active_tasks (id, user_id, email, password, first_name, last_name, expires_at, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                Number(item.id) || null,
                String(item.user_id),
                this.normalizeEmail(item.email),
                item.password || null,
                item.first_name || null,
                item.last_name || null,
                item.expires_at || null,
                item.created_at || this._now()
            ]);
        }

        for (const item of pendingAccounts) {
            await this.run(`
                INSERT INTO pending_accounts (id, user_id, email, password, task_type, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
            `, [
                Number(item.id) || null,
                String(item.user_id),
                this.normalizeEmail(item.email),
                item.password || null,
                item.task_type || 'email',
                item.created_at || this._now()
            ]);
        }

        for (const item of gmailAccounts) {
            await this.run(`
                INSERT INTO gmail_accounts (id, user_id, email, status, created_at)
                VALUES (?, ?, ?, ?, ?)
            `, [
                Number(item.id) || null,
                String(item.user_id),
                this.normalizeEmail(item.email),
                item.status || 'pending',
                item.created_at || this._now()
            ]);
        }

        for (const item of withdrawalRequests) {
            await this.run(`
                INSERT INTO withdrawal_requests (id, user_id, amount, currency, method, details, status, created_at, processed_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                Number(item.id) || null,
                String(item.user_id),
                Number(item.amount) || 0,
                item.currency || 'EGP',
                item.method || null,
                item.details || null,
                item.status || 'pending',
                item.created_at || this._now(),
                item.processed_at || null
            ]);
        }

        for (const email of persistentExportEmails) {
            const normalized = this.normalizeEmail(email);
            if (normalized) {
                await this.run('INSERT OR IGNORE INTO persistent_export_emails (email, created_at) VALUES (?, ?)', [normalized, this._now()]);
            }
        }

        for (const email of exportExcludedEmails) {
            const normalized = this.normalizeEmail(email);
            if (normalized) {
                await this.run('INSERT OR IGNORE INTO export_excluded_emails (email, created_at) VALUES (?, ?)', [normalized, this._now()]);
            }
        }
    }

    async addUser(userId, username) {
        await this.run(`
            INSERT INTO users (id, username, created_at, last_active)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(id) DO NOTHING
        `, [String(userId), username || null, this._now(), this._now()]);
        return String(userId);
    }

    async getUser(userId) {
        return await this.get('SELECT * FROM users WHERE id = ?', [String(userId)]);
    }

    async getAllUsers() {
        return await this.all('SELECT * FROM users WHERE is_banned = 0 ORDER BY created_at ASC');
    }

    async searchUsers(searchTerm, limit = 5) {
        const term = `%${String(searchTerm || '').toLowerCase()}%`;
        return await this.all(`
            SELECT * FROM users
            WHERE LOWER(COALESCE(username, '')) LIKE ?
            ORDER BY username COLLATE NOCASE ASC
            LIMIT ?
        `, [term, Number(limit) || 5]);
    }

    async searchUser(searchTerm) {
        const direct = await this.get('SELECT * FROM users WHERE id = ?', [String(searchTerm)]);
        if (direct) return direct;
        const rows = await this.searchUsers(searchTerm, 1);
        return rows[0] || null;
    }

    async updateUserLanguage(userId, language) {
        const result = await this.run(
            'UPDATE users SET preferred_language = ?, last_active = ? WHERE id = ?',
            [language, this._now(), String(userId)]
        );
        return result.changes;
    }

    async setUserPreferredCurrency(userId, currency) {
        const result = await this.run(
            'UPDATE users SET preferred_currency = ?, last_active = ? WHERE id = ?',
            [currency, this._now(), String(userId)]
        );
        return result.changes;
    }

    async setUserBalance(userId, balance) {
        const result = await this.run(
            'UPDATE users SET balance = ?, last_active = ? WHERE id = ?',
            [Number(balance) || 0, this._now(), String(userId)]
        );
        return result.changes;
    }

    async setUserUSDBalance(userId, balance) {
        const result = await this.run(
            'UPDATE users SET balance_usd = ?, last_active = ? WHERE id = ?',
            [Number(balance) || 0, this._now(), String(userId)]
        );
        return result.changes;
    }

    async banUser(userId) {
        const result = await this.run('UPDATE users SET is_banned = 1 WHERE id = ?', [String(userId)]);
        return result.changes;
    }

    async unbanUser(userId) {
        const result = await this.run('UPDATE users SET is_banned = 0 WHERE id = ?', [String(userId)]);
        return result.changes;
    }

    async getUserCount() {
        const row = await this.get('SELECT COUNT(*) AS count FROM users');
        return Number(row?.count || 0);
    }

    async getTotalBalance() {
        const row = await this.get('SELECT COALESCE(SUM(balance), 0) AS total FROM users');
        return Number(row?.total || 0);
    }

    async getLastUsers(limit = 10) {
        return await this.all('SELECT * FROM users ORDER BY datetime(created_at) DESC LIMIT ?', [Number(limit) || 10]);
    }

    async setSetting(key, value) {
        const result = await this.run(`
            INSERT INTO settings (key, value, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
        `, [String(key), String(value), this._now()]);
        return result.changes || 1;
    }

    async getSetting(key) {
        const row = await this.get('SELECT value FROM settings WHERE key = ?', [String(key)]);
        return row ? row.value : null;
    }

    async generateReferralCode(userId) {
        const code = `REF${String(userId).slice(-6)}${Date.now().toString().slice(-4)}`;
        await this.run('UPDATE users SET referral_code = ? WHERE id = ?', [code, String(userId)]);
        return code;
    }

    async getUserByReferralCode(referralCode) {
        return await this.get('SELECT * FROM users WHERE referral_code = ?', [referralCode]);
    }

    async setUserReferredBy(userId, referrerId) {
        const result = await this.run('UPDATE users SET referred_by = ? WHERE id = ?', [String(referrerId), String(userId)]);
        return result.changes;
    }

    async addReferral(referrerId, referredId, referralCode) {
        const result = await this.run(`
            INSERT INTO referrals (referrer_id, referred_id, referral_code, reward_earned, reward_currency, status, created_at, rewarded_at)
            VALUES (?, ?, ?, 0, 'EGP', 'pending', ?, NULL)
        `, [String(referrerId), String(referredId), referralCode || null, this._now()]);
        return Number(result.lastID);
    }

    async addReferralReward(referrerId, referredId, rewardAmount, currency) {
        const result = await this.run(`
            INSERT INTO referrals (referrer_id, referred_id, referral_code, reward_earned, reward_currency, status, created_at, rewarded_at)
            VALUES (?, ?, NULL, ?, ?, 'completed', ?, ?)
        `, [
            String(referrerId),
            String(referredId),
            Number(rewardAmount) || 0,
            currency || 'EGP',
            this._now(),
            this._now()
        ]);
        return Number(result.lastID);
    }

    async getReferralByReferredId(referredId) {
        return await this.get('SELECT * FROM referrals WHERE referred_id = ? ORDER BY id DESC LIMIT 1', [String(referredId)]);
    }

    async updateReferralReward(referralId, reward, currency) {
        const result = await this.run(`
            UPDATE referrals
            SET reward_earned = ?, reward_currency = ?, status = 'completed', rewarded_at = ?
            WHERE id = ?
        `, [Number(reward) || 0, currency || 'EGP', this._now(), Number(referralId)]);
        return result.changes;
    }

    async getUserReferrals(userId) {
        return await this.all(`
            SELECT r.*, u.username AS referred_username
            FROM referrals r
            LEFT JOIN users u ON u.id = r.referred_id
            WHERE r.referrer_id = ?
            ORDER BY datetime(r.created_at) DESC
        `, [String(userId)]);
    }

    async getReferralStats(userId) {
        const row = await this.get(`
            SELECT
                COUNT(*) AS total_referrals,
                SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_referrals,
                COALESCE(SUM(CASE WHEN status = 'completed' THEN reward_earned ELSE 0 END), 0) AS total_earned
            FROM referrals
            WHERE referrer_id = ?
        `, [String(userId)]);
        return {
            total_referrals: Number(row?.total_referrals || 0),
            completed_referrals: Number(row?.completed_referrals || 0),
            total_earned: Number(row?.total_earned || 0)
        };
    }

    async addAvailableAccount(email, password, firstName = null, lastName = null) {
        const normalizedEmail = this.normalizeEmail(email);
        const existing = await this.get('SELECT id FROM available_accounts WHERE LOWER(email) = ?', [normalizedEmail]);
        if (existing) {
            await this.run(`
                UPDATE available_accounts
                SET email = ?, password = ?, first_name = ?, last_name = ?
                WHERE id = ?
            `, [normalizedEmail, password || null, firstName || null, lastName || null, existing.id]);
            return Number(existing.id);
        }

        const result = await this.run(`
            INSERT INTO available_accounts (email, password, first_name, last_name, created_at)
            VALUES (?, ?, ?, ?, ?)
        `, [normalizedEmail, password || null, firstName || null, lastName || null, this._now()]);
        return Number(result.lastID);
    }

    async getAvailableAccountsCount() {
        const row = await this.get('SELECT COUNT(*) AS count FROM available_accounts');
        return Number(row?.count || 0);
    }

    async getAvailableAccountsList(limit = 50, offset = 0) {
        return await this.all(`
            SELECT * FROM available_accounts
            ORDER BY datetime(created_at) DESC
            LIMIT ? OFFSET ?
        `, [Number(limit) || 50, Number(offset) || 0]);
    }

    async removeAvailableAccountById(accountId) {
        const result = await this.run('DELETE FROM available_accounts WHERE id = ?', [Number(accountId)]);
        return result.changes;
    }

    async deleteAllAvailableAccounts() {
        const result = await this.run('DELETE FROM available_accounts');
        return result.changes;
    }

    async addActiveTask(userId, email, password, expiresAt, firstName = null, lastName = null) {
        await this.run('DELETE FROM active_tasks WHERE user_id = ?', [String(userId)]);
        const result = await this.run(`
            INSERT INTO active_tasks (user_id, email, password, first_name, last_name, expires_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [String(userId), this.normalizeEmail(email), password || null, firstName || null, lastName || null, expiresAt || null, this._now()]);
        return Number(result.lastID);
    }

    async getActiveTask(userId) {
        return await this.get('SELECT * FROM active_tasks WHERE user_id = ?', [String(userId)]);
    }

    async removeActiveTask(userId) {
        const result = await this.run('DELETE FROM active_tasks WHERE user_id = ?', [String(userId)]);
        return result.changes;
    }

    async addPendingAccount(userId, email, password, taskType = 'email') {
        const result = await this.run(`
            INSERT INTO pending_accounts (user_id, email, password, task_type, created_at)
            VALUES (?, ?, ?, ?, ?)
        `, [String(userId), this.normalizeEmail(email), password || null, taskType || 'email', this._now()]);
        return Number(result.lastID);
    }

    async getPendingAccounts() {
        return await this.all('SELECT * FROM pending_accounts ORDER BY datetime(created_at) DESC');
    }

    async getPendingAccountById(id) {
        return await this.get('SELECT * FROM pending_accounts WHERE id = ?', [Number(id)]);
    }

    async removePendingAccount(accountId) {
        const result = await this.run('DELETE FROM pending_accounts WHERE id = ?', [Number(accountId)]);
        return result.changes;
    }

    async emailExistsGlobally(email) {
        const normalized = this.normalizeEmail(email);
        if (!normalized) return false;
        const row = await this.get(`
            SELECT EXISTS(SELECT 1 FROM gmail_accounts WHERE LOWER(email) = ?) AS gmail_exists,
                   EXISTS(SELECT 1 FROM pending_accounts WHERE LOWER(email) = ?) AS pending_exists
        `, [normalized, normalized]);
        return Boolean(row?.gmail_exists || row?.pending_exists);
    }

    async findEmailGlobally(email) {
        const normalized = this.normalizeEmail(email);
        if (!normalized) return null;
        const gmail = await this.get('SELECT * FROM gmail_accounts WHERE LOWER(email) = ? LIMIT 1', [normalized]);
        if (gmail) return { type: 'gmail', ...gmail };
        const pending = await this.get('SELECT * FROM pending_accounts WHERE LOWER(email) = ? LIMIT 1', [normalized]);
        if (pending) return { type: 'pending', ...pending };
        return null;
    }

    async getPersistentExportEmails() {
        const rows = await this.all('SELECT email FROM persistent_export_emails ORDER BY email ASC');
        return rows.map((row) => row.email);
    }

    async getExportExcludedEmails() {
        const rows = await this.all('SELECT email FROM export_excluded_emails ORDER BY email ASC');
        return rows.map((row) => row.email);
    }

    async addPersistentExportEmails(emails) {
        let added = 0;
        const values = Array.isArray(emails) ? emails : [];

        await this.exec('BEGIN');
        try {
            for (const email of values) {
                const normalized = this.normalizeEmail(email);
                if (!normalized) continue;
                const insert = await this.run(
                    'INSERT OR IGNORE INTO persistent_export_emails (email, created_at) VALUES (?, ?)',
                    [normalized, this._now()]
                );
                await this.run('DELETE FROM export_excluded_emails WHERE email = ?', [normalized]);
                added += Number(insert.changes || 0);
            }
            await this.exec('COMMIT');
        } catch (error) {
            await this.exec('ROLLBACK');
            throw error;
        }

        return added;
    }

    async removePersistentExportEmails(emails) {
        const toRemove = Array.from(new Set((emails || []).map((email) => this.normalizeEmail(email)).filter(Boolean)));
        let removedFromPersistent = 0;

        await this.exec('BEGIN');
        try {
            for (const email of toRemove) {
                const removed = await this.run('DELETE FROM persistent_export_emails WHERE email = ?', [email]);
                removedFromPersistent += Number(removed.changes || 0);
                await this.run('INSERT OR IGNORE INTO export_excluded_emails (email, created_at) VALUES (?, ?)', [email, this._now()]);
            }
            await this.exec('COMMIT');
        } catch (error) {
            await this.exec('ROLLBACK');
            throw error;
        }

        const remainingRow = await this.get('SELECT COUNT(*) AS count FROM persistent_export_emails');
        const excludedRow = await this.get('SELECT COUNT(*) AS count FROM export_excluded_emails');

        return {
            removedFromPersistent,
            hiddenFromExport: toRemove.length,
            remainingPersistent: Number(remainingRow?.count || 0),
            excludedTotal: Number(excludedRow?.count || 0)
        };
    }

    async addGmailAccount(userId, email) {
        const result = await this.run(`
            INSERT INTO gmail_accounts (user_id, email, status, created_at)
            VALUES (?, ?, 'pending', ?)
        `, [String(userId), this.normalizeEmail(email), this._now()]);
        return Number(result.lastID);
    }

    async getPendingGmailAccounts() {
        return await this.all(`
            SELECT * FROM gmail_accounts
            WHERE status = 'pending'
            ORDER BY datetime(created_at) DESC
        `);
    }

    async getAllPendingEmails() {
        return await this.all(`
            SELECT * FROM pending_accounts
            WHERE task_type = 'email'
            ORDER BY datetime(created_at) DESC
        `);
    }

    async getAllApprovedEmails() {
        return await this.all(`
            SELECT * FROM gmail_accounts
            WHERE status = 'approved'
            ORDER BY datetime(created_at) DESC
        `);
    }

    async getAllRejectedEmails() {
        return await this.all(`
            SELECT * FROM gmail_accounts
            WHERE status = 'rejected'
            ORDER BY datetime(created_at) DESC
        `);
    }

    async updateGmailAccountStatus(accountId, status) {
        const result = await this.run('UPDATE gmail_accounts SET status = ? WHERE id = ?', [status, Number(accountId)]);
        return result.changes;
    }

    async getGmailAccountById(id) {
        return await this.get('SELECT * FROM gmail_accounts WHERE id = ?', [Number(id)]);
    }

    async checkGmailEmailExists(email) {
        return await this.emailExistsGlobally(email);
    }

    async getAllGmailAccountsByUser(userId) {
        return await this.all(`
            SELECT * FROM gmail_accounts
            WHERE user_id = ?
            ORDER BY datetime(created_at) DESC
        `, [String(userId)]);
    }

    async addWithdrawalRequest(userId, amount, currency, method, details) {
        const result = await this.run(`
            INSERT INTO withdrawal_requests (user_id, amount, currency, method, details, status, created_at, processed_at)
            VALUES (?, ?, ?, ?, ?, 'pending', ?, NULL)
        `, [String(userId), Number(amount) || 0, currency || 'EGP', method || null, details || null, this._now()]);
        return Number(result.lastID);
    }

    async getPendingWithdrawalRequests() {
        return await this.all(`
            SELECT * FROM withdrawal_requests
            WHERE status = 'pending'
            ORDER BY datetime(created_at) DESC
        `);
    }

    async getWithdrawalRequest(requestId) {
        return await this.get('SELECT * FROM withdrawal_requests WHERE id = ?', [Number(requestId)]);
    }

    async completeWithdrawalRequest(requestId) {
        const result = await this.run(
            "UPDATE withdrawal_requests SET status = 'completed', processed_at = ? WHERE id = ?",
            [this._now(), Number(requestId)]
        );
        return result.changes;
    }
}

module.exports = Database;
