const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'bot_data.json');

class Database {
    constructor() {
        this.data = {
            users: [],
            settings: {},
            referrals: [],
            available_accounts: [],
            active_tasks: [],
            pending_accounts: [],
            gmail_accounts: [],
            withdrawal_requests: [],
            persistent_export_emails: [],
            export_excluded_emails: [],
            nextIds: {
                available_accounts: 1,
                active_tasks: 1,
                pending_accounts: 1,
                gmail_accounts: 1,
                referrals: 1,
                withdrawal_requests: 1
            }
        };

        this._load();
    }

    _load() {
        try {
            if (fs.existsSync(DATA_FILE)) {
                const raw = fs.readFileSync(DATA_FILE, 'utf8');
                if (raw.trim().length > 0) {
                    const parsed = JSON.parse(raw);
                    // Merge with defaults to avoid missing keys
                    this.data = Object.assign({}, this.data, parsed);
                    if (!this.data.nextIds) {
                        this.data.nextIds = {
                            available_accounts: 1,
                            active_tasks: 1,
                            pending_accounts: 1,
                            gmail_accounts: 1,
                            referrals: 1,
                            withdrawal_requests: 1
                        };
                    }
                }
            }
        } catch (err) {
            console.error('Failed to load data file:', err.message);
        }
    }

    _save() {
        try {
            const tempFile = `${DATA_FILE}.tmp`;
            const backupFile = `${DATA_FILE}.bak`;
            const payload = JSON.stringify(this.data, null, 2);

            fs.writeFileSync(tempFile, payload, 'utf8');
            if (fs.existsSync(DATA_FILE)) {
                fs.copyFileSync(DATA_FILE, backupFile);
            }
            fs.renameSync(tempFile, DATA_FILE);
        } catch (err) {
            console.error('Failed to save data file:', err.message);
        }
    }

    _now() {
        return new Date().toISOString();
    }

    _nextId(table) {
        const id = this.data.nextIds[table] || 1;
        this.data.nextIds[table] = id + 1;
        return id;
    }

    // ========= Users =========

    async addUser(userId, username) {
        const existing = this.data.users.find(u => u.id === userId);
        if (existing) return existing.id;

        const user = {
            id: userId,
            username: username || null,
            balance: 0,
            balance_usd: 0,
            preferred_currency: 'EGP',
            preferred_language: 'ar',
            is_banned: 0,
            referral_code: null,
            referred_by: null,
            created_at: this._now(),
            last_active: this._now()
        };
        this.data.users.push(user);
        this._save();
        return user.id;
    }

    async getUser(userId) {
        return this.data.users.find(u => u.id === userId) || null;
    }

    async getAllUsers() {
        return this.data.users.filter(u => !u.is_banned);
    }

    async searchUsers(searchTerm, limit = 5) {
        const term = String(searchTerm || '').toLowerCase();
        const results = this.data.users.filter(u => (u.username || '').toLowerCase().includes(term));
        results.sort((a, b) => (a.username || '').localeCompare(b.username || ''));
        return results.slice(0, limit);
    }

    async searchUser(searchTerm) {
        // Try by id first
        let user = this.data.users.find(u => u.id === searchTerm);
        if (user) return user;
        const term = String(searchTerm || '').toLowerCase();
        user = this.data.users
            .filter(u => (u.username || '').toLowerCase().includes(term))
            .sort((a, b) => (a.username || '').localeCompare(b.username || ''))[0];
        return user || null;
    }

    async updateUserLanguage(userId, language) {
        const user = this.data.users.find(u => u.id === userId);
        if (!user) return 0;
        user.preferred_language = language;
        user.last_active = this._now();
        this._save();
        return 1;
    }

    async setUserPreferredCurrency(userId, currency) {
        const user = this.data.users.find(u => u.id === userId);
        if (!user) return 0;
        user.preferred_currency = currency;
        user.last_active = this._now();
        this._save();
        return 1;
    }

    async setUserBalance(userId, balance) {
        const user = this.data.users.find(u => u.id === userId);
        if (!user) return 0;
        user.balance = Number(balance) || 0;
        user.last_active = this._now();
        this._save();
        return 1;
    }

    async setUserUSDBalance(userId, balance) {
        const user = this.data.users.find(u => u.id === userId);
        if (!user) return 0;
        user.balance_usd = Number(balance) || 0;
        user.last_active = this._now();
        this._save();
        return 1;
    }

    async banUser(userId) {
        const user = this.data.users.find(u => u.id === userId);
        if (!user) return 0;
        user.is_banned = 1;
        this._save();
        return 1;
    }

    async unbanUser(userId) {
        const user = this.data.users.find(u => u.id === userId);
        if (!user) return 0;
        user.is_banned = 0;
        this._save();
        return 1;
    }

    async getUserCount() {
        return this.data.users.length;
    }

    async getTotalBalance() {
        return this.data.users.reduce((sum, u) => sum + (Number(u.balance) || 0), 0);
    }

    async getLastUsers(limit = 10) {
        const sorted = [...this.data.users].sort((a, b) => {
            return new Date(b.created_at || 0) - new Date(a.created_at || 0);
        });
        return sorted.slice(0, limit);
    }

    // ========= Settings =========

    async setSetting(key, value) {
        this.data.settings[key] = {
            value: String(value),
            updated_at: this._now()
        };
        this._save();
        return 1;
    }

    async getSetting(key) {
        const item = this.data.settings[key];
        return item ? item.value : null;
    }

    // ========= Referrals =========

    async generateReferralCode(userId) {
        const code = `REF${String(userId).slice(-6)}${Date.now().toString().slice(-4)}`;
        const user = this.data.users.find(u => u.id === userId);
        if (user) {
            user.referral_code = code;
            this._save();
        }
        return code;
    }

    async getUserByReferralCode(referralCode) {
        return this.data.users.find(u => u.referral_code === referralCode) || null;
    }

    async setUserReferredBy(userId, referrerId) {
        const user = this.data.users.find(u => u.id === userId);
        if (!user) return 0;
        user.referred_by = referrerId;
        this._save();
        return 1;
    }

    async addReferral(referrerId, referredId, referralCode) {
        const ref = {
            id: this._nextId('referrals'),
            referrer_id: referrerId,
            referred_id: referredId,
            referral_code: referralCode,
            reward_earned: 0,
            reward_currency: 'EGP',
            status: 'pending',
            created_at: this._now(),
            rewarded_at: null
        };
        this.data.referrals.push(ref);
        this._save();
        return ref.id;
    }

    async addReferralReward(referrerId, referredId, rewardAmount, currency) {
        const reward = {
            id: this._nextId('referrals'),
            referrer_id: referrerId,
            referred_id: referredId,
            referral_code: null,
            reward_earned: Number(rewardAmount) || 0,
            reward_currency: currency || 'EGP',
            status: 'completed',
            created_at: this._now(),
            rewarded_at: this._now()
        };
        this.data.referrals.push(reward);
        this._save();
        return reward.id;
    }

    async getReferralByReferredId(referredId) {
        return this.data.referrals.find(r => r.referred_id === referredId) || null;
    }

    async updateReferralReward(referralId, reward, currency) {
        const r = this.data.referrals.find(x => x.id === referralId);
        if (!r) return 0;
        r.reward_earned = Number(reward) || 0;
        r.reward_currency = currency || 'EGP';
        r.status = 'completed';
        r.rewarded_at = this._now();
        this._save();
        return 1;
    }

    async getUserReferrals(userId) {
        const list = this.data.referrals.filter(r => r.referrer_id === userId);
        // Attach referred_username similar to SQL JOIN
        return list
            .map(r => {
                const u = this.data.users.find(x => x.id === r.referred_id);
                return Object.assign({}, r, { referred_username: u ? u.username : null });
            })
            .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    }

    async getReferralStats(userId) {
        const list = this.data.referrals.filter(r => r.referrer_id === userId);
        const total_referrals = list.length;
        const completed = list.filter(r => r.status === 'completed');
        const completed_referrals = completed.length;
        const total_earned = completed.reduce((s, r) => s + (Number(r.reward_earned) || 0), 0);
        return { total_referrals, completed_referrals, total_earned };
    }

    // ========= Available accounts =========

    async addAvailableAccount(email, password, firstName = null, lastName = null) {
        let acc = this.data.available_accounts.find(a => a.email === email);
        if (acc) {
            acc.password = password;
            acc.first_name = firstName;
            acc.last_name = lastName;
        } else {
            acc = {
                id: this._nextId('available_accounts'),
                email,
                password,
                first_name: firstName,
                last_name: lastName,
                created_at: this._now()
            };
            this.data.available_accounts.push(acc);
        }
        this._save();
        return acc.id;
    }

    async getAvailableAccountsCount() {
        return this.data.available_accounts.length;
    }

    async getAvailableAccountsList(limit = 50, offset = 0) {
        const sorted = [...this.data.available_accounts].sort((a, b) => {
            return new Date(b.created_at || 0) - new Date(a.created_at || 0);
        });
        return sorted.slice(offset, offset + limit);
    }

    async removeAvailableAccountById(accountId) {
        const before = this.data.available_accounts.length;
        this.data.available_accounts = this.data.available_accounts.filter(a => a.id !== accountId);
        const after = this.data.available_accounts.length;
        this._save();
        return before - after;
    }

    async deleteAllAvailableAccounts() {
        const deleted = this.data.available_accounts.length;
        this.data.available_accounts = [];
        this._save();
        return deleted;
    }

    // ========= Active tasks / pending accounts =========

    async addActiveTask(userId, email, password, expiresAt, firstName = null, lastName = null) {
        // Only one active task per user (like original)
        this.data.active_tasks = this.data.active_tasks.filter(t => t.user_id !== userId);
        const task = {
            id: this._nextId('active_tasks'),
            user_id: userId,
            email,
            password,
            first_name: firstName,
            last_name: lastName,
            expires_at: expiresAt,
            created_at: this._now()
        };
        this.data.active_tasks.push(task);
        this._save();
        return task.id;
    }

    async getActiveTask(userId) {
        return this.data.active_tasks.find(t => t.user_id === userId) || null;
    }

    async removeActiveTask(userId) {
        const before = this.data.active_tasks.length;
        this.data.active_tasks = this.data.active_tasks.filter(t => t.user_id !== userId);
        const after = this.data.active_tasks.length;
        this._save();
        return before - after;
    }

    async addPendingAccount(userId, email, password, taskType = 'email') {
        const acc = {
            id: this._nextId('pending_accounts'),
            user_id: userId,
            email,
            password,
            task_type: taskType,
            created_at: this._now()
        };
        this.data.pending_accounts.push(acc);
        this._save();
        return acc.id;
    }

    async getPendingAccounts() {
        const sorted = [...this.data.pending_accounts].sort((a, b) => {
            return new Date(b.created_at || 0) - new Date(a.created_at || 0);
        });
        return sorted;
    }

    async getPendingAccountById(id) {
        return this.data.pending_accounts.find(a => a.id === id) || null;
    }

    async removePendingAccount(accountId) {
        const before = this.data.pending_accounts.length;
        this.data.pending_accounts = this.data.pending_accounts.filter(a => a.id !== accountId);
        const after = this.data.pending_accounts.length;
        this._save();
        return before - after;
    }

    // ========= Gmail accounts =========

    normalizeEmail(email) {
        return String(email || '').trim().toLowerCase();
    }

    async emailExistsGlobally(email) {
        const normalized = this.normalizeEmail(email);
        if (!normalized) return false;

        const gmailExists = this.data.gmail_accounts.some(acc => this.normalizeEmail(acc.email) === normalized);
        if (gmailExists) return true;

        const pendingExists = this.data.pending_accounts.some(acc => this.normalizeEmail(acc.email) === normalized);
        return pendingExists;
    }

    async findEmailGlobally(email) {
        const normalized = this.normalizeEmail(email);
        if (!normalized) return null;

        const gmail = this.data.gmail_accounts.find(acc => this.normalizeEmail(acc.email) === normalized);
        if (gmail) return { type: 'gmail', ...gmail };

        const pending = this.data.pending_accounts.find(acc => this.normalizeEmail(acc.email) === normalized);
        if (pending) return { type: 'pending', ...pending };

        return null;
    }

    async getPersistentExportEmails() {
        const list = Array.isArray(this.data.persistent_export_emails) ? this.data.persistent_export_emails : [];
        return [...list].map(email => this.normalizeEmail(email)).filter(Boolean).sort();
    }

    async getExportExcludedEmails() {
        const list = Array.isArray(this.data.export_excluded_emails) ? this.data.export_excluded_emails : [];
        return [...list].map(email => this.normalizeEmail(email)).filter(Boolean).sort();
    }

    async addPersistentExportEmails(emails) {
        if (!Array.isArray(this.data.persistent_export_emails)) {
            this.data.persistent_export_emails = [];
        }
        if (!Array.isArray(this.data.export_excluded_emails)) {
            this.data.export_excluded_emails = [];
        }

        const current = new Set(this.data.persistent_export_emails.map(e => this.normalizeEmail(e)).filter(Boolean));
        const excluded = new Set(this.data.export_excluded_emails.map(e => this.normalizeEmail(e)).filter(Boolean));
        let added = 0;

        for (const email of emails || []) {
            const normalized = this.normalizeEmail(email);
            if (!normalized) continue;
            if (!current.has(normalized)) {
                current.add(normalized);
                added++;
            }
            if (excluded.has(normalized)) {
                excluded.delete(normalized);
            }
        }

        this.data.persistent_export_emails = Array.from(current).sort();
        this.data.export_excluded_emails = Array.from(excluded).sort();
        this._save();
        return added;
    }

    async removePersistentExportEmails(emails) {
        if (!Array.isArray(this.data.persistent_export_emails)) {
            this.data.persistent_export_emails = [];
        }
        if (!Array.isArray(this.data.export_excluded_emails)) {
            this.data.export_excluded_emails = [];
        }

        const toRemove = new Set((emails || []).map(email => this.normalizeEmail(email)).filter(Boolean));
        const persistentBefore = this.data.persistent_export_emails.length;
        this.data.persistent_export_emails = this.data.persistent_export_emails.filter(email => !toRemove.has(this.normalizeEmail(email)));

        const excluded = new Set(this.data.export_excluded_emails.map(e => this.normalizeEmail(e)).filter(Boolean));
        for (const email of toRemove) {
            excluded.add(email);
        }
        this.data.export_excluded_emails = Array.from(excluded).sort();

        const removedFromPersistent = persistentBefore - this.data.persistent_export_emails.length;
        this._save();
        return {
            removedFromPersistent,
            hiddenFromExport: toRemove.size,
            remainingPersistent: this.data.persistent_export_emails.length,
            excludedTotal: this.data.export_excluded_emails.length
        };
    }

    async addGmailAccount(userId, email) {
        const normalizedEmail = this.normalizeEmail(email);
        const acc = {
            id: this._nextId('gmail_accounts'),
            user_id: userId,
            email: normalizedEmail,
            status: 'pending',
            created_at: this._now()
        };
        this.data.gmail_accounts.push(acc);
        this._save();
        return acc.id;
    }

    async getPendingGmailAccounts() {
        const list = this.data.gmail_accounts.filter(a => a.status === 'pending');
        return list.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    }

    async getAllPendingEmails() {
        const list = this.data.pending_accounts.filter(a => a.task_type === 'email');
        return list.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    }

    async getAllApprovedEmails() {
        const list = this.data.gmail_accounts.filter(a => a.status === 'approved');
        return list.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    }

    async getAllRejectedEmails() {
        const list = this.data.gmail_accounts.filter(a => a.status === 'rejected');
        return list.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    }

    async updateGmailAccountStatus(accountId, status) {
        const acc = this.data.gmail_accounts.find(a => a.id === accountId);
        if (!acc) return 0;
        acc.status = status;
        this._save();
        return 1;
    }

    async getGmailAccountById(id) {
        return this.data.gmail_accounts.find(a => a.id === id) || null;
    }

    async checkGmailEmailExists(email) {
        return await this.emailExistsGlobally(email);
    }

    async getAllGmailAccountsByUser(userId) {
        const list = this.data.gmail_accounts.filter(a => a.user_id === userId);
        return list.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    }

    // ========= Withdrawals =========

    async addWithdrawalRequest(userId, amount, currency, method, details) {
        const req = {
            id: this._nextId('withdrawal_requests'),
            user_id: userId,
            amount: Number(amount) || 0,
            currency: currency || 'EGP',
            method,
            details,
            status: 'pending',
            created_at: this._now(),
            processed_at: null
        };
        this.data.withdrawal_requests.push(req);
        this._save();
        return req.id;
    }

    async getPendingWithdrawalRequests() {
        const list = this.data.withdrawal_requests.filter(r => r.status === 'pending');
        return list.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    }

    async getWithdrawalRequest(requestId) {
        const id = Number(requestId);
        return this.data.withdrawal_requests.find(r => r.id === id) || null;
    }

    async completeWithdrawalRequest(requestId) {
        const id = Number(requestId);
        const r = this.data.withdrawal_requests.find(x => x.id === id);
        if (!r) return 0;
        r.status = 'completed';
        r.processed_at = this._now();
        this._save();
        return 1;
    }
}

module.exports = Database;

