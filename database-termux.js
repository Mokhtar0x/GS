// نسخة معدلة من database.js تعمل على Termux
// استخدم better-sqlite3 بدلاً من sqlite3

let Database;
let isBetterSqlite = false;

// محاولة تحميل sqlite3 أولاً، ثم better-sqlite3 كبديل
try {
    const sqlite3 = require('sqlite3').verbose();
    Database = sqlite3.Database;
    console.log('✅ Using sqlite3');
} catch (error) {
    try {
        const BetterSqlite3 = require('better-sqlite3');
        Database = BetterSqlite3;
        isBetterSqlite = true;
        console.log('✅ Using better-sqlite3 (Termux compatible)');
    } catch (error2) {
        console.error('❌ No SQLite library found. Install one:');
        console.error('   npm install sqlite3');
        console.error('   OR');
        console.error('   npm install better-sqlite3');
        process.exit(1);
    }
}

class DatabaseWrapper {
    constructor() {
        if (isBetterSqlite) {
            // better-sqlite3 (synchronous)
            this.db = new Database('bot_database.db');
            this.db.pragma('journal_mode = WAL');
            this.db.pragma('synchronous = NORMAL');
            this.db.pragma('cache_size = 10000');
            this.db.pragma('temp_store = MEMORY');
            console.log('Connected to SQLite database (better-sqlite3)');
        } else {
            // sqlite3 (asynchronous)
            this.db = new Database('bot_database.db', (err) => {
                if (err) {
                    console.error('Database connection error:', err);
                } else {
                    console.log('Connected to SQLite database (sqlite3)');
                }
            });
            this.db.run('PRAGMA journal_mode = WAL');
            this.db.run('PRAGMA synchronous = NORMAL');
            this.db.run('PRAGMA cache_size = 10000');
            this.db.run('PRAGMA temp_store = MEMORY');
            this.db.run('PRAGMA mmap_size = 268435456');
        }

        this.isBetterSqlite = isBetterSqlite;
        this.connectionPool = [];
        this.maxConnections = 10;

        this.initTables();
        this.updateTables();
        this.createIndexes();
    }

    // Wrapper للتعامل مع كلا المكتبتين
    run(sql, params = []) {
        return new Promise((resolve, reject) => {
            if (this.isBetterSqlite) {
                try {
                    const result = this.db.prepare(sql).run(params);
                    resolve(result);
                } catch (error) {
                    reject(error);
                }
            } else {
                this.db.run(sql, params, function(error) {
                    if (error) reject(error);
                    else resolve({ lastID: this.lastID, changes: this.changes });
                });
            }
        });
    }

    get(sql, params = []) {
        return new Promise((resolve, reject) => {
            if (this.isBetterSqlite) {
                try {
                    const result = this.db.prepare(sql).get(params);
                    resolve(result);
                } catch (error) {
                    reject(error);
                }
            } else {
                this.db.get(sql, params, (error, row) => {
                    if (error) reject(error);
                    else resolve(row);
                });
            }
        });
    }

    all(sql, params = []) {
        return new Promise((resolve, reject) => {
            if (this.isBetterSqlite) {
                try {
                    const result = this.db.prepare(sql).all(params);
                    resolve(result);
                } catch (error) {
                    reject(error);
                }
            } else {
                this.db.all(sql, params, (error, rows) => {
                    if (error) reject(error);
                    else resolve(rows);
                });
            }
        });
    }

    initTables() {
        const tables = [
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
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                last_active DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (referred_by) REFERENCES users (id)
            )`,
            `CREATE TABLE IF NOT EXISTS available_accounts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT NOT NULL,
                password TEXT NOT NULL,
                first_name TEXT,
                last_name TEXT,
                status TEXT DEFAULT 'pending',
                assigned_to TEXT,
                assigned_at DATETIME,
                completed_at DATETIME,
                approved_by TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (assigned_to) REFERENCES users (id)
            )`,
            `CREATE TABLE IF NOT EXISTS tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                email TEXT NOT NULL,
                password TEXT,
                first_name TEXT,
                last_name TEXT,
                status TEXT DEFAULT 'pending',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                completed_at DATETIME,
                FOREIGN KEY (user_id) REFERENCES users (id)
            )`,
            `CREATE TABLE IF NOT EXISTS withdrawal_requests (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                amount REAL NOT NULL,
                currency TEXT DEFAULT 'EGP',
                payment_method TEXT NOT NULL,
                payment_details TEXT NOT NULL,
                status TEXT DEFAULT 'pending',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                processed_at DATETIME,
                processed_by TEXT,
                FOREIGN KEY (user_id) REFERENCES users (id)
            )`,
            `CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,
            `CREATE TABLE IF NOT EXISTS referrals (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                referrer_id TEXT NOT NULL,
                referred_id TEXT NOT NULL,
                referral_code TEXT NOT NULL,
                status TEXT DEFAULT 'pending',
                reward_amount REAL DEFAULT 0,
                reward_currency TEXT DEFAULT 'EGP',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                completed_at DATETIME,
                FOREIGN KEY (referrer_id) REFERENCES users (id),
                FOREIGN KEY (referred_id) REFERENCES users (id)
            )`
        ];

        if (this.isBetterSqlite) {
            tables.forEach(sql => {
                try {
                    this.db.exec(sql);
                } catch (error) {
                    console.error('Error creating table:', error);
                }
            });
        } else {
            tables.forEach(sql => {
                this.db.run(sql, (error) => {
                    if (error) console.error('Error creating table:', error);
                });
            });
        }
    }

    updateTables() {
        // Add any schema updates here
        const updates = [
            `ALTER TABLE users ADD COLUMN IF NOT EXISTS preferred_currency TEXT DEFAULT 'EGP'`,
            `ALTER TABLE users ADD COLUMN IF NOT EXISTS preferred_language TEXT DEFAULT 'ar'`,
            `ALTER TABLE users ADD COLUMN IF NOT EXISTS balance_usd REAL DEFAULT 0`
        ];

        updates.forEach(sql => {
            if (this.isBetterSqlite) {
                try {
                    this.db.exec(sql);
                } catch (error) {
                    // Column might already exist
                }
            } else {
                this.db.run(sql, (error) => {
                    // Column might already exist
                });
            }
        });
    }

    createIndexes() {
        const indexes = [
            'CREATE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code)',
            'CREATE INDEX IF NOT EXISTS idx_users_referred_by ON users(referred_by)',
            'CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON tasks(user_id)',
            'CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)',
            'CREATE INDEX IF NOT EXISTS idx_withdrawal_user_id ON withdrawal_requests(user_id)',
            'CREATE INDEX IF NOT EXISTS idx_withdrawal_status ON withdrawal_requests(status)',
            'CREATE INDEX IF NOT EXISTS idx_accounts_status ON available_accounts(status)',
            'CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_id)',
            'CREATE INDEX IF NOT EXISTS idx_referrals_referred ON referrals(referred_id)'
        ];

        if (this.isBetterSqlite) {
            indexes.forEach(sql => {
                try {
                    this.db.exec(sql);
                } catch (error) {
                    console.error('Error creating index:', error);
                }
            });
            console.log('Database indexes created for optimal performance');
        } else {
            indexes.forEach(sql => {
                this.db.run(sql, (error) => {
                    if (error) console.error('Error creating index:', error);
                });
            });
            setTimeout(() => {
                console.log('Database indexes created for optimal performance');
            }, 100);
        }
    }

    // باقي الوظائف تبقى كما هي...
    // سأضيف فقط الوظائف الأساسية

    async addUser(userId, username) {
        return this.run(
            'INSERT OR IGNORE INTO users (id, username) VALUES (?, ?)',
            [userId, username]
        );
    }

    async getUser(userId) {
        return this.get('SELECT * FROM users WHERE id = ?', [userId]);
    }

    async getAllUsers() {
        return this.all('SELECT * FROM users WHERE is_banned = 0');
    }

    async setUserBalance(userId, balance) {
        return this.run(
            'UPDATE users SET balance = ? WHERE id = ?',
            [balance, userId]
        );
    }

    async banUser(userId) {
        return this.run(
            'UPDATE users SET is_banned = 1 WHERE id = ?',
            [userId]
        );
    }

    async unbanUser(userId) {
        return this.run(
            'UPDATE users SET is_banned = 0 WHERE id = ?',
            [userId]
        );
    }

    async getSetting(key) {
        const row = await this.get('SELECT value FROM settings WHERE key = ?', [key]);
        return row ? row.value : null;
    }

    async setSetting(key, value) {
        return this.run(
            'INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
            [key, value]
        );
    }

    // ... باقي الوظائف من database.js الأصلي
}

module.exports = DatabaseWrapper;
