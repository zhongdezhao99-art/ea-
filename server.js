import "dotenv/config";
import "dotenv/config";
import bcrypt from "bcryptjs";
import express from "express";
import jwt from "jsonwebtoken";
import multer from "multer";
import mysql from "mysql2/promise";
import nodemailer from "nodemailer";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = Number(process.env.PORT || 5173);
const jwtSecret = process.env.JWT_SECRET || "local-dev-change-this-secret";
const uploadRoot = path.join(__dirname, process.env.UPLOAD_DIR || "uploads");
const imageUploadDir = path.join(uploadRoot, "images");
const programUploadDir = path.join(uploadRoot, "strategy-files");
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const emailCodeCooldownSeconds = 60;
const forumCategoryIds = new Set(["general", "forex_ea", "futures", "crypto", "stock_index", "deployment"]);

fs.mkdirSync(imageUploadDir, { recursive: true });
fs.mkdirSync(programUploadDir, { recursive: true });

const pool = mysql.createPool({
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "ea_app",
  password: process.env.DB_PASSWORD || "ea_app_123456",
  database: process.env.DB_NAME || "ea_strategy_demo",
  waitForConnections: true,
  connectionLimit: 10,
  namedPlaceholders: true,
  charset: "utf8mb4",
});

const mailer = process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 465),
      secure: String(process.env.SMTP_SECURE || "true") === "true",
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    })
  : null;

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function assertEmail(email) {
  if (!emailPattern.test(email)) throw httpError(400, "邮箱格式不正确");
}

function makeEmailCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function normalizeUploadOriginalName(originalName) {
  const raw = String(originalName || "");
  if (!raw || /[\u4e00-\u9fff]/.test(raw)) return raw;
  const decoded = Buffer.from(raw, "latin1").toString("utf8");
  return /[\u4e00-\u9fff]/.test(decoded) && !decoded.includes("\uFFFD") ? decoded : raw;
}

function requestUploadOriginalName(req) {
  return normalizeUploadOriginalName(req.body?.originalName || req.file?.originalname);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function getActiveBlockedWords() {
  const [rows] = await pool.execute("SELECT id, word, status, DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at FROM blocked_words ORDER BY created_at DESC, id DESC");
  return rows;
}

function maskSensitiveText(value, words) {
  let text = String(value || "");
  for (const row of words) {
    const word = String(row.word || "").trim();
    if (!word || row.status !== "active") continue;
    text = text.replace(new RegExp(escapeRegExp(word), "gi"), "***");
  }
  return text;
}

const uploadExt = (file) => path.extname(normalizeUploadOriginalName(file.originalname) || file.originalname || "").toLowerCase();
const makeFilename = (file) => `${Date.now()}-${Math.round(Math.random() * 1e9)}${uploadExt(file)}`;

const imageUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, imageUploadDir),
    filename: (_req, file, cb) => cb(null, makeFilename(file)),
  }),
  fileFilter: (_req, file, cb) => cb(null, /^image\/(png|jpe?g|webp|gif)$/i.test(file.mimetype)),
  limits: { fileSize: 5 * 1024 * 1024 },
});

const programUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, programUploadDir),
    filename: (_req, file, cb) => cb(null, makeFilename(file)),
  }),
  fileFilter: (_req, file, cb) => cb(null, [".ex4", ".ex5", ".zip", ".dll", ".set"].includes(uploadExt(file))),
  limits: { fileSize: 50 * 1024 * 1024 },
});

async function ensureSchema() {
  const [columns] = await pool.execute(
    `SELECT COLUMN_NAME
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'strategies'
       AND COLUMN_NAME IN ('billing_mode', 'seller_contact')`
  );
  const existing = new Set(columns.map((row) => row.COLUMN_NAME));
  if (!existing.has("billing_mode")) {
    await pool.execute("ALTER TABLE strategies ADD COLUMN billing_mode ENUM('one_time', 'subscription') NOT NULL DEFAULT 'one_time' AFTER price");
  }
  if (!existing.has("seller_contact")) {
    await pool.execute("ALTER TABLE strategies ADD COLUMN seller_contact VARCHAR(160) NOT NULL DEFAULT '' AFTER billing_mode");
  }
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS blocked_words (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      word VARCHAR(120) NOT NULL,
      status ENUM('active', 'disabled') NOT NULL DEFAULT 'active',
      created_by BIGINT UNSIGNED NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uk_blocked_words_word (word),
      KEY idx_blocked_words_status (status),
      CONSTRAINT fk_blocked_words_admin
        FOREIGN KEY (created_by) REFERENCES users(id)
        ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `);
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS forum_posts (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id BIGINT UNSIGNED NOT NULL,
      category VARCHAR(60) NOT NULL DEFAULT 'general',
      title VARCHAR(160) NOT NULL,
      body TEXT NOT NULL,
      status ENUM('visible', 'hidden') NOT NULL DEFAULT 'visible',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_forum_posts_category_time (category, status, created_at),
      KEY idx_forum_posts_status_time (status, created_at),
      KEY idx_forum_posts_user (user_id),
      CONSTRAINT fk_forum_posts_user
        FOREIGN KEY (user_id) REFERENCES users(id)
        ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `);
  const [forumColumns] = await pool.execute(
    `SELECT COLUMN_NAME
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'forum_posts'
       AND COLUMN_NAME = 'category'`
  );
  if (!forumColumns.length) {
    await pool.execute("ALTER TABLE forum_posts ADD COLUMN category VARCHAR(60) NOT NULL DEFAULT 'general' AFTER user_id");
    await pool.execute("ALTER TABLE forum_posts ADD INDEX idx_forum_posts_category_time (category, status, created_at)");
  }
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS forum_replies (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      post_id BIGINT UNSIGNED NOT NULL,
      user_id BIGINT UNSIGNED NOT NULL,
      body TEXT NOT NULL,
      status ENUM('visible', 'hidden') NOT NULL DEFAULT 'visible',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_forum_replies_post_time (post_id, created_at),
      KEY idx_forum_replies_user (user_id),
      CONSTRAINT fk_forum_replies_post
        FOREIGN KEY (post_id) REFERENCES forum_posts(id)
        ON DELETE CASCADE,
      CONSTRAINT fk_forum_replies_user
        FOREIGN KEY (user_id) REFERENCES users(id)
        ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `);
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    emailVerifiedAt: user.email_verified_at,
    role: user.role,
    balance: Number(user.balance),
    displayName: user.display_name,
    avatarUrl: user.avatar_url,
    status: user.status,
  };
}

function signToken(user) {
  return jwt.sign({ sub: user.id, username: user.username, role: user.role }, jwtSecret, { expiresIn: "8h" });
}

async function getUserByUsername(username) {
  const [rows] = await pool.execute("SELECT * FROM users WHERE username = :username LIMIT 1", { username });
  return rows[0] || null;
}

async function getUserByEmail(email) {
  const [rows] = await pool.execute("SELECT * FROM users WHERE email = :email LIMIT 1", { email });
  return rows[0] || null;
}

async function getUserById(id) {
  const [rows] = await pool.execute("SELECT * FROM users WHERE id = :id LIMIT 1", { id });
  return rows[0] || null;
}

async function assertEmailAvailable(email, userId = null) {
  const [rows] = await pool.execute(
    "SELECT id FROM users WHERE email = :email AND (:userId IS NULL OR id <> :userId) LIMIT 1",
    { email, userId }
  );
  if (rows[0]) throw httpError(409, "该邮箱已被绑定");
}

async function sendEmailCode(email, code, purpose) {
  if (!mailer) throw httpError(500, "SMTP 邮件服务未配置");
  const purposeLabel = { register: "注册账户", bind: "绑定邮箱", reset: "重置密码" }[purpose] || "邮箱验证";
  await mailer.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: email,
    subject: `EA Strategy Hub ${purposeLabel}验证码`,
    text: `你的验证码是 ${code}，10 分钟内有效。若非本人操作，请忽略本邮件。`,
    html: `<p>你的 EA Strategy Hub ${purposeLabel}验证码是：</p><p style="font-size:24px;font-weight:700;letter-spacing:4px">${code}</p><p>10 分钟内有效。若非本人操作，请忽略本邮件。</p>`,
  });
}

async function createEmailVerificationCode({ email, purpose, userId = null }) {
  const code = makeEmailCode();
  const codeHash = await bcrypt.hash(code, 10);
  await sendEmailCode(email, code, purpose);
  await pool.execute(
    "INSERT INTO email_verification_codes (email, purpose, user_id, code_hash, expires_at) VALUES (:email, :purpose, :userId, :codeHash, DATE_ADD(NOW(), INTERVAL 10 MINUTE))",
    { email, purpose, userId, codeHash }
  );
}

async function assertEmailCodeCooldown({ email, purpose, userId = null }) {
  const [rows] = await pool.execute(
    `SELECT TIMESTAMPDIFF(SECOND, created_at, NOW()) AS age
     FROM email_verification_codes
     WHERE email = :email AND purpose = :purpose AND user_id <=> :userId
     ORDER BY created_at DESC, id DESC LIMIT 1`,
    { email, purpose, userId }
  );
  const age = Number(rows[0]?.age ?? emailCodeCooldownSeconds);
  if (age < emailCodeCooldownSeconds) {
    throw httpError(429, `请等待 ${emailCodeCooldownSeconds - age} 秒后再发送验证码`);
  }
}

async function verifyEmailVerificationCode({ email, purpose, code, userId = null }) {
  const [rows] = await pool.execute(
    `SELECT * FROM email_verification_codes
     WHERE email = :email AND purpose = :purpose AND user_id <=> :userId
       AND used_at IS NULL AND expires_at > NOW()
     ORDER BY created_at DESC, id DESC LIMIT 1`,
    { email, purpose, userId }
  );
  const row = rows[0];
  if (!row || row.attempts >= 5) throw httpError(400, "验证码无效或已过期");
  const ok = await bcrypt.compare(String(code || ""), row.code_hash);
  if (!ok) {
    await pool.execute("UPDATE email_verification_codes SET attempts = attempts + 1 WHERE id = :id", { id: row.id });
    throw httpError(400, "验证码无效或已过期");
  }
  await pool.execute("UPDATE email_verification_codes SET used_at = NOW() WHERE id = :id", { id: row.id });
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return res.status(401).json({ ok: false, error: "缺少登录凭证" });
  try {
    req.auth = jwt.verify(token, jwtSecret);
    next();
  } catch {
    res.status(401).json({ ok: false, error: "登录已过期，请重新登录" });
  }
}

async function attachUser(req, res, next) {
  try {
    const user = await getUserById(req.auth.sub);
    if (!user || user.status !== "active") return res.status(403).json({ ok: false, error: "账户不可用" });
    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
}

function requireAdmin(req, res, next) {
  if (req.user.role !== "admin") return res.status(403).json({ ok: false, error: "需要管理员权限" });
  next();
}

async function getAdminData() {
  const [users] = await pool.execute(`
    SELECT u.id, u.username, u.email, u.display_name, u.avatar_url, u.role, u.balance, u.status,
      DATE_FORMAT(u.created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
      (SELECT COUNT(*) FROM strategies s WHERE s.owner_id = u.id) AS strategy_count,
      (SELECT COUNT(*) FROM strategies s WHERE s.owner_id = u.id AND s.status = 'listed') AS listed_strategy_count,
      (SELECT COUNT(*) FROM strategies s WHERE s.owner_id = u.id AND s.status = 'pending_review') AS pending_strategy_count,
      (SELECT COUNT(*)
       FROM strategies s
       JOIN orders o ON o.strategy_id = s.id
       WHERE s.owner_id = u.id AND o.status = 'paid') AS strategy_paid_orders,
      (SELECT COALESCE(SUM(o.amount), 0)
       FROM strategies s
       JOIN orders o ON o.strategy_id = s.id
       WHERE s.owner_id = u.id AND o.status = 'paid') AS strategy_sales
    FROM users u
    ORDER BY u.created_at DESC, u.id DESC LIMIT 200
  `);
  const [orders] = await pool.execute(`
    SELECT o.order_no, buyer.id AS buyer_id, buyer.username AS buyer_username, seller.id AS seller_id, seller.username AS seller_username,
      s.id AS strategy_id, s.title AS strategy_title, o.amount, o.status,
      DATE_FORMAT(o.paid_at, '%Y-%m-%d %H:%i:%s') AS paid_at,
      DATE_FORMAT(o.created_at, '%Y-%m-%d %H:%i:%s') AS created_at
    FROM orders o
    JOIN users buyer ON buyer.id = o.buyer_id
    JOIN strategies s ON s.id = o.strategy_id
    JOIN users seller ON seller.id = s.owner_id
    ORDER BY o.created_at DESC, o.id DESC LIMIT 200
  `);
  const [[customerMetrics]] = await pool.execute(`
    SELECT
      COUNT(*) AS total_customers,
      SUM(CASE WHEN DATE(created_at) = CURRENT_DATE() THEN 1 ELSE 0 END) AS today_new_customers,
      SUM(CASE WHEN YEARWEEK(created_at, 1) = YEARWEEK(CURRENT_DATE(), 1) THEN 1 ELSE 0 END) AS week_new_customers,
      SUM(CASE WHEN created_at >= DATE_FORMAT(CURRENT_DATE(), '%Y-%m-01') THEN 1 ELSE 0 END) AS month_new_customers
    FROM users
    WHERE role = 'user'
  `);
  const [[financeMetrics]] = await pool.execute(`
    SELECT
      COUNT(*) AS order_count,
      SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) AS paid_order_count,
      SUM(CASE WHEN status = 'refunded' THEN 1 ELSE 0 END) AS refund_count,
      COALESCE(SUM(CASE WHEN status = 'paid' AND DATE(paid_at) = CURRENT_DATE() THEN amount ELSE 0 END), 0) AS today_sales,
      COALESCE(SUM(CASE WHEN status = 'paid' AND YEARWEEK(paid_at, 1) = YEARWEEK(CURRENT_DATE(), 1) THEN amount ELSE 0 END), 0) AS week_sales,
      COALESCE(SUM(CASE WHEN status = 'paid' AND paid_at >= DATE_FORMAT(CURRENT_DATE(), '%Y-%m-01') THEN amount ELSE 0 END), 0) AS month_sales,
      COALESCE(SUM(CASE WHEN status = 'paid' THEN amount ELSE 0 END), 0) AS total_sales
    FROM orders
  `);
  const [[strategyMetrics]] = await pool.execute(`
    SELECT
      SUM(CASE WHEN status = 'listed' THEN 1 ELSE 0 END) AS listed_strategies,
      SUM(CASE WHEN status = 'pending_review' THEN 1 ELSE 0 END) AS pending_strategies
    FROM strategies
  `);
  const [[withdrawMetrics]] = await pool.execute(`
    SELECT COALESCE(SUM(u.balance), 0) AS technical_pending_withdrawal
    FROM users u
    WHERE u.role = 'user'
      AND u.balance > 0
      AND EXISTS (SELECT 1 FROM strategies s WHERE s.owner_id = u.id)
  `);
  const [technicalAccounts] = await pool.execute(`
    SELECT u.id, u.username, u.email, u.display_name, u.balance, COUNT(s.id) AS strategy_count,
      SUM(CASE WHEN s.status = 'listed' THEN 1 ELSE 0 END) AS listed_count,
      SUM(CASE WHEN s.status = 'pending_review' THEN 1 ELSE 0 END) AS pending_count,
      COALESCE(SUM(CASE WHEN o.status = 'paid' THEN o.amount ELSE 0 END), 0) AS strategy_sales,
      COUNT(CASE WHEN o.status = 'paid' THEN o.id END) AS paid_order_count,
      DATE_FORMAT(u.created_at, '%Y-%m-%d %H:%i:%s') AS created_at
    FROM users u
    JOIN strategies s ON s.owner_id = u.id
    LEFT JOIN orders o ON o.strategy_id = s.id
    WHERE u.role = 'user'
    GROUP BY u.id, u.username, u.email, u.display_name, u.balance, u.created_at
    ORDER BY u.balance DESC, u.created_at DESC
    LIMIT 200
  `);
  const [paymentRecords] = await pool.execute(`
    SELECT pr.id, o.order_no, pr.provider, pr.provider_trade_no, pr.amount, pr.status,
      DATE_FORMAT(pr.created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
      DATE_FORMAT(pr.updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at
    FROM payment_records pr
    JOIN orders o ON o.id = pr.order_id
    ORDER BY pr.created_at DESC, pr.id DESC LIMIT 200
  `);
  const [ledgerRows] = await pool.execute(`
    SELECT l.id, u.username, u.display_name, l.entry_type, l.amount, l.balance_after, l.description,
      DATE_FORMAT(l.created_at, '%Y-%m-%d %H:%i:%s') AS created_at
    FROM account_ledger l
    JOIN users u ON u.id = l.user_id
    ORDER BY l.created_at DESC, l.id DESC LIMIT 300
  `);
  const [auditRows] = await pool.execute(`
    SELECT a.id, admin.username AS admin_username, a.action, a.target_type, a.target_id, a.detail,
      DATE_FORMAT(a.created_at, '%Y-%m-%d %H:%i:%s') AS created_at
    FROM admin_audit_logs a
    JOIN users admin ON admin.id = a.admin_id
    ORDER BY a.created_at DESC, a.id DESC LIMIT 200
  `);
  const [hotStrategies] = await pool.execute(`
    SELECT s.id, s.title, u.username AS seller_username, s.status, s.price,
      COUNT(o.id) AS paid_orders, COALESCE(SUM(o.amount), 0) AS sales_amount,
      (SELECT COUNT(*) FROM comments c WHERE c.strategy_id = s.id AND c.status = 'visible') AS comment_count
    FROM strategies s
    JOIN users u ON u.id = s.owner_id
    LEFT JOIN orders o ON o.strategy_id = s.id AND o.status = 'paid'
    GROUP BY s.id, s.title, u.username, s.status, s.price
    ORDER BY paid_orders DESC, sales_amount DESC, s.created_at DESC LIMIT 20
  `);
  const [forumAdminPosts] = await pool.execute(`
    SELECT p.id, p.category, p.title, p.status, u.username AS author_username,
      DATE_FORMAT(p.created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
      (SELECT COUNT(*) FROM forum_replies r WHERE r.post_id = p.id AND r.status = 'visible') AS reply_count
    FROM forum_posts p
    JOIN users u ON u.id = p.user_id
    ORDER BY p.created_at DESC, p.id DESC LIMIT 200
  `);
  const [commentAdminRows] = await pool.execute(`
    SELECT c.id, c.body, c.status, u.username AS author_username, s.title AS strategy_title,
      DATE_FORMAT(c.created_at, '%Y-%m-%d %H:%i:%s') AS created_at
    FROM comments c
    JOIN users u ON u.id = c.user_id
    JOIN strategies s ON s.id = c.strategy_id
    ORDER BY c.created_at DESC, c.id DESC LIMIT 200
  `);
  const blockedWords = await getActiveBlockedWords();
  const paidOrders = Number(financeMetrics.paid_order_count || 0);
  const orderCount = Number(financeMetrics.order_count || 0);
  return {
    users: users.map((row) => ({
      ...row,
      balance: Number(row.balance),
      strategy_count: Number(row.strategy_count || 0),
      listed_strategy_count: Number(row.listed_strategy_count || 0),
      pending_strategy_count: Number(row.pending_strategy_count || 0),
      strategy_paid_orders: Number(row.strategy_paid_orders || 0),
      strategy_sales: Number(row.strategy_sales || 0),
    })),
    orders: orders.map((row) => ({ ...row, amount: Number(row.amount) })),
    metrics: {
      totalCustomers: Number(customerMetrics.total_customers || 0),
      todayNewCustomers: Number(customerMetrics.today_new_customers || 0),
      weekNewCustomers: Number(customerMetrics.week_new_customers || 0),
      monthNewCustomers: Number(customerMetrics.month_new_customers || 0),
      orderCount,
      paidOrderCount: paidOrders,
      paymentSuccessRate: orderCount ? Math.round((paidOrders / orderCount) * 1000) / 10 : 0,
      refundCount: Number(financeMetrics.refund_count || 0),
      todaySales: Number(financeMetrics.today_sales || 0),
      weekSales: Number(financeMetrics.week_sales || 0),
      monthSales: Number(financeMetrics.month_sales || 0),
      totalSales: Number(financeMetrics.total_sales || 0),
      platformIncome: Number(financeMetrics.total_sales || 0),
      vendorShare: Number(financeMetrics.total_sales || 0),
      platformFee: 0,
      listedStrategies: Number(strategyMetrics.listed_strategies || 0),
      pendingStrategies: Number(strategyMetrics.pending_strategies || 0),
      technicalPendingWithdrawal: Number(withdrawMetrics.technical_pending_withdrawal || 0),
      complaintCount: 0,
      reportCount: 0,
    },
    technicalAccounts: technicalAccounts.map((row) => ({
      ...row,
      balance: Number(row.balance),
      strategy_count: Number(row.strategy_count),
      listed_count: Number(row.listed_count),
      pending_count: Number(row.pending_count || 0),
      strategy_sales: Number(row.strategy_sales || 0),
      paid_order_count: Number(row.paid_order_count || 0),
    })),
    paymentRecords: paymentRecords.map((row) => ({ ...row, amount: Number(row.amount) })),
    ledger: ledgerRows.map((row) => ({ ...row, amount: Number(row.amount), balance_after: Number(row.balance_after) })),
    auditLogs: auditRows,
    hotStrategies: hotStrategies.map((row) => ({ ...row, price: Number(row.price), paid_orders: Number(row.paid_orders), sales_amount: Number(row.sales_amount), comment_count: Number(row.comment_count) })),
    forumPosts: forumAdminPosts.map((row) => ({ ...row, reply_count: Number(row.reply_count) })),
    comments: commentAdminRows,
    blockedWords,
  };
}

async function bootstrap(userId) {
  const user = await getUserById(userId);
  const blockedWords = await getActiveBlockedWords();
  const [strategyRows] = await pool.execute(
    `
    SELECT s.*, u.username AS owner_username, u.display_name AS author_name,
      (SELECT COUNT(*) FROM orders o WHERE o.strategy_id = s.id AND o.status = 'paid') AS total_downloads,
      (SELECT COUNT(*) FROM orders o WHERE o.strategy_id = s.id AND o.status = 'paid' AND o.paid_at >= DATE_FORMAT(CURRENT_DATE(), '%Y-%m-01')) AS monthly_downloads,
      (SELECT COUNT(*) FROM orders o WHERE o.strategy_id = s.id AND o.status = 'paid' AND DATE(o.paid_at) = CURRENT_DATE()) AS daily_downloads,
      EXISTS (SELECT 1 FROM orders o WHERE o.strategy_id = s.id AND o.buyer_id = :userId AND o.status = 'paid') AS purchased,
      (SELECT COUNT(*) FROM comments c WHERE c.strategy_id = s.id AND c.status = 'visible') AS comment_count,
      (SELECT image_url FROM strategy_images i WHERE i.strategy_id = s.id AND i.image_type = 'cover' ORDER BY sort_order LIMIT 1) AS cover_url,
      (SELECT image_url FROM strategy_images i WHERE i.strategy_id = s.id AND i.image_type = 'backtest' ORDER BY sort_order LIMIT 1) AS backtest_url,
      (SELECT image_url FROM strategy_images i WHERE i.strategy_id = s.id AND i.image_type = 'data_chart' ORDER BY sort_order LIMIT 1) AS data_url,
      (SELECT original_name FROM strategy_files f WHERE f.strategy_id = s.id AND f.file_type = 'compiled_program' ORDER BY f.created_at DESC, f.id DESC LIMIT 1) AS program_name,
      (SELECT file_url FROM strategy_files f WHERE f.strategy_id = s.id AND f.file_type = 'compiled_program' ORDER BY f.created_at DESC, f.id DESC LIMIT 1) AS program_url
    FROM strategies s
    JOIN users u ON u.id = s.owner_id
    ORDER BY s.volume DESC, s.created_at DESC
    `,
    { userId }
  );

  const strategies = strategyRows.map((row) => {
    const canDownload = Boolean(row.program_url && (user.role === "admin" || row.owner_id === user.id || row.purchased));
    return {
      id: String(row.id),
      title: row.title,
      type: row.trade_type,
      platform: row.platform,
      symbol: row.symbol_scope,
      price: Number(row.price),
      billingMode: row.billing_mode,
      sellerContact: row.seller_contact,
      volume: Number(row.volume),
      totalDownloads: Math.max(Number(row.volume || 0), Number(row.total_downloads || 0)),
      monthlyDownloads: Number(row.monthly_downloads || 0),
      dailyDownloads: Number(row.daily_downloads || 0),
      comments: Number(row.comment_count),
      risk: row.risk_level,
      status: row.status,
      ownerDeletedAt: row.owner_deleted_at,
      author: row.author_name,
      owner: row.owner_username,
      desc: row.description,
      image: row.cover_url,
      backtestImage: row.backtest_url,
      dataImage: row.data_url,
      purchased: Boolean(row.purchased),
      programName: row.program_name,
      hasFile: Boolean(row.program_url),
      downloadUrl: canDownload ? `/api/strategies/${row.id}/download` : null,
    };
  });

  const [commentRows] = await pool.execute(`
    SELECT c.strategy_id, u.display_name, c.body,
      EXISTS (SELECT 1 FROM orders o WHERE o.strategy_id = c.strategy_id AND o.buyer_id = c.user_id AND o.status = 'paid') AS bought
    FROM comments c JOIN users u ON u.id = c.user_id
    WHERE c.status = 'visible'
    ORDER BY c.created_at ASC, c.id ASC
  `);
  const comments = {};
  for (const row of commentRows) {
    const key = String(row.strategy_id);
    comments[key] ||= [];
    comments[key].push({ user: row.display_name, body: maskSensitiveText(row.body, blockedWords), bought: Boolean(row.bought) });
  }

  const [postRows] = await pool.execute(`
    SELECT p.id, p.category, p.title, p.body, p.user_id, u.display_name AS author, u.avatar_url AS author_avatar_url,
      DATE_FORMAT(p.created_at, '%Y-%m-%d %H:%i') AS created_at,
      (SELECT COUNT(*) FROM forum_replies r WHERE r.post_id = p.id AND r.status = 'visible') AS reply_count
    FROM forum_posts p
    JOIN users u ON u.id = p.user_id
    WHERE p.status = 'visible'
    ORDER BY p.created_at DESC, p.id DESC
    LIMIT 100
  `);
  const [replyRows] = await pool.execute(`
    SELECT r.id, r.post_id, r.body, u.display_name AS author, u.avatar_url AS author_avatar_url,
      DATE_FORMAT(r.created_at, '%Y-%m-%d %H:%i') AS created_at
    FROM forum_replies r
    JOIN users u ON u.id = r.user_id
    JOIN forum_posts p ON p.id = r.post_id
    WHERE r.status = 'visible' AND p.status = 'visible'
    ORDER BY r.created_at ASC, r.id ASC
  `);
  const repliesByPost = {};
  for (const row of replyRows) {
    const key = String(row.post_id);
    repliesByPost[key] ||= [];
    repliesByPost[key].push({
      id: String(row.id),
      author: row.author,
      authorAvatarUrl: row.author_avatar_url,
      body: maskSensitiveText(row.body, blockedWords),
      createdAt: row.created_at,
    });
  }
  const forumPosts = postRows.map((row) => ({
    id: String(row.id),
    userId: String(row.user_id),
    category: row.category || "general",
    title: maskSensitiveText(row.title, blockedWords),
    body: maskSensitiveText(row.body, blockedWords),
    author: row.author,
    authorAvatarUrl: row.author_avatar_url,
    createdAt: row.created_at,
    replyCount: Number(row.reply_count || 0),
    replies: repliesByPost[String(row.id)] || [],
  }));

  const [ledgerRows] = await pool.execute(
    `
    SELECT DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS time, entry_type AS type, description AS target, amount, 'done' AS status
    FROM account_ledger WHERE user_id = :userId ORDER BY created_at DESC, id DESC
    `,
    { userId }
  );

  const payload = {
    user: publicUser(user),
    strategies,
    comments,
    forumPosts,
    ledger: ledgerRows.map((row) => ({ ...row, amount: Number(row.amount) })),
  };
  if (user.role === "admin") payload.admin = await getAdminData();
  return payload;
}

async function writeAudit(adminId, action, targetType, targetId, detail) {
  await pool.execute(
    "INSERT INTO admin_audit_logs (admin_id, action, target_type, target_id, detail) VALUES (:adminId, :action, :targetType, :targetId, CAST(:detail AS JSON))",
    { adminId, action, targetType, targetId: targetId || null, detail: JSON.stringify(detail || {}) }
  );
}

async function loginWithRole(req, res, next, requiredRole = null) {
  try {
    const { username, password } = req.body || {};
    const email = normalizeEmail(req.body?.email || req.body?.username);
    const user = requiredRole === "admin" ? await getUserByUsername(username) : await getUserByEmail(email);
    const credentialError = requiredRole === "admin" ? "账号或密码错误" : "邮箱或密码错误";
    if (!user || user.status !== "active") return res.status(401).json({ ok: false, error: credentialError });
    if (requiredRole && user.role !== requiredRole) return res.status(403).json({ ok: false, error: "请使用正确入口登录" });
    if (!requiredRole && user.role === "admin") return res.status(401).json({ ok: false, error: credentialError });
    const passwordOk = await bcrypt.compare(String(password || ""), user.password_hash);
    if (!passwordOk) return res.status(401).json({ ok: false, error: credentialError });
    res.json({ ok: true, user: publicUser(user), token: signToken(user) });
  } catch (error) {
    next(error);
  }
}

app.use(express.json({ limit: "1mb" }));
app.use("/uploads", express.static(uploadRoot));
app.use(express.static(__dirname));

app.get("/api/health", async (_req, res, next) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.get("/api/bootstrap", requireAuth, attachUser, async (req, res, next) => {
  try {
    res.json(await bootstrap(req.user.id));
  } catch (error) {
    next(error);
  }
});

app.post("/api/login", (req, res, next) => loginWithRole(req, res, next));
app.post("/api/admin/login", (req, res, next) => loginWithRole(req, res, next, "admin"));

app.post("/api/email/register-code", async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body?.email);
    assertEmail(email);
    await assertEmailAvailable(email);
    await assertEmailCodeCooldown({ email, purpose: "register" });
    await createEmailVerificationCode({ email, purpose: "register" });
    res.json({ ok: true });
  } catch (error) {
    if (error.code === "EAUTH" || error.code === "ECONNECTION" || error.code === "ETIMEDOUT") return res.status(500).json({ ok: false, error: "邮件发送失败，请检查 SMTP 配置" });
    next(error);
  }
});

app.post("/api/register", async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const username = email;
    const emailCode = String(req.body?.emailCode || req.body?.code || "").trim();
    const password = String(req.body?.password || "");
    const confirmPassword = String(req.body?.confirmPassword || "");
    const displayName = String(req.body?.displayName || email.split("@")[0]).trim();
    assertEmail(email);
    if (!emailCode) return res.status(400).json({ ok: false, error: "请输入邮箱验证码" });
    if (password.length < 6) return res.status(400).json({ ok: false, error: "密码至少 6 位" });
    if (!confirmPassword) return res.status(400).json({ ok: false, error: "请再次输入密码" });
    if (password !== confirmPassword) return res.status(400).json({ ok: false, error: "两次输入的密码不一致" });
    await assertEmailAvailable(email);
    await verifyEmailVerificationCode({ email, purpose: "register", code: emailCode });
    const passwordHash = await bcrypt.hash(password, 10);
    const [result] = await pool.execute(
      "INSERT INTO users (username, email, email_verified_at, password_hash, display_name, role, balance, status) VALUES (:username, :email, NOW(), :passwordHash, :displayName, 'user', 0, 'active')",
      { username, email, passwordHash, displayName }
    );
    const user = await getUserById(result.insertId);
    res.json({ ok: true, user: publicUser(user), token: signToken(user) });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") return res.status(409).json({ ok: false, error: "该邮箱已被注册" });
    next(error);
  }
});

app.post("/api/password-reset/send-code", async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body?.email);
    assertEmail(email);
    const user = await getUserByEmail(email);
    if (!user || user.status !== "active" || user.role === "admin") return res.json({ ok: true });
    await assertEmailCodeCooldown({ email, purpose: "reset", userId: user.id });
    await createEmailVerificationCode({ email, purpose: "reset", userId: user.id });
    res.json({ ok: true });
  } catch (error) {
    if (error.code === "EAUTH" || error.code === "ECONNECTION" || error.code === "ETIMEDOUT") return res.status(500).json({ ok: false, error: "邮件发送失败，请检查 SMTP 配置" });
    next(error);
  }
});

app.post("/api/password-reset/confirm", async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const code = String(req.body?.code || "").trim();
    const password = String(req.body?.password || "");
    const confirmPassword = String(req.body?.confirmPassword || "");
    assertEmail(email);
    if (!code) return res.status(400).json({ ok: false, error: "请输入邮箱验证码" });
    if (password.length < 6) return res.status(400).json({ ok: false, error: "密码至少 6 位" });
    if (!confirmPassword) return res.status(400).json({ ok: false, error: "请再次输入密码" });
    if (password !== confirmPassword) return res.status(400).json({ ok: false, error: "两次输入的密码不一致" });
    const user = await getUserByEmail(email);
    if (!user || user.status !== "active" || user.role === "admin") return res.status(400).json({ ok: false, error: "验证码无效或已过期" });
    await verifyEmailVerificationCode({ email, purpose: "reset", userId: user.id, code });
    const passwordHash = await bcrypt.hash(password, 10);
    await pool.execute("UPDATE users SET password_hash = :passwordHash WHERE id = :userId", { passwordHash, userId: user.id });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post("/api/purchase", requireAuth, attachUser, async (req, res, next) => {
  const strategyId = Number(req.body?.strategyId);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[strategy]] = await conn.execute("SELECT * FROM strategies WHERE id = ? FOR UPDATE", [strategyId]);
    if (!strategy) {
      await conn.rollback();
      return res.status(404).json({ ok: false, error: "策略不存在" });
    }
    if (strategy.owner_id === req.user.id) {
      await conn.rollback();
      return res.status(400).json({ ok: false, error: "不能购买自己发布的策略" });
    }
    const [[existing]] = await conn.execute("SELECT id FROM orders WHERE buyer_id = ? AND strategy_id = ? AND status = 'paid' LIMIT 1", [req.user.id, strategyId]);
    if (existing) {
      await conn.commit();
      return res.json({ ok: true, alreadyPurchased: true, bootstrap: await bootstrap(req.user.id) });
    }
    const price = Number(strategy.price);
    const [[freshUser]] = await conn.execute("SELECT balance FROM users WHERE id = ? FOR UPDATE", [req.user.id]);
    if (Number(freshUser.balance) < price) {
      await conn.rollback();
      return res.status(400).json({ ok: false, error: "账户余额不足" });
    }
    const orderNo = `ORD${Date.now()}${Math.floor(Math.random() * 10000)}`;
    await conn.execute("UPDATE users SET balance = balance - ? WHERE id = ?", [price, req.user.id]);
    const [orderResult] = await conn.execute("INSERT INTO orders (order_no, buyer_id, strategy_id, amount, status, paid_at) VALUES (?, ?, ?, ?, 'paid', NOW())", [orderNo, req.user.id, strategyId, price]);
    await conn.execute("INSERT INTO payment_records (order_id, provider, provider_trade_no, amount, status, raw_payload) VALUES (?, 'demo_pay', ?, ?, 'verified', CAST(? AS JSON))", [orderResult.insertId, `PAY${orderResult.insertId}`, price, JSON.stringify({ source: "api" })]);
    await conn.execute("UPDATE strategies SET volume = volume + 1 WHERE id = ?", [strategyId]);
    await conn.execute("UPDATE users SET balance = balance + ? WHERE id = ?", [price, strategy.owner_id]);
    const [[balanceRow]] = await conn.execute("SELECT balance FROM users WHERE id = ?", [req.user.id]);
    const [[sellerBalanceRow]] = await conn.execute("SELECT balance FROM users WHERE id = ?", [strategy.owner_id]);
    await conn.execute("INSERT INTO account_ledger (user_id, order_id, entry_type, amount, balance_after, description) VALUES (?, ?, 'purchase', ?, ?, ?)", [req.user.id, orderResult.insertId, -price, balanceRow.balance, `购买 ${strategy.title}`]);
    await conn.execute("INSERT INTO account_ledger (user_id, order_id, entry_type, amount, balance_after, description) VALUES (?, ?, 'sale_income', ?, ?, ?)", [strategy.owner_id, orderResult.insertId, price, sellerBalanceRow.balance, `出售 ${strategy.title}`]);
    await conn.commit();
    res.json({ ok: true, orderNo, bootstrap: await bootstrap(req.user.id) });
  } catch (error) {
    await conn.rollback();
    next(error);
  } finally {
    conn.release();
  }
});

app.post("/api/payments/callback", async (req, res, next) => {
  try {
    const { orderNo, providerTradeNo, status = "verified" } = req.body || {};
    const [result] = await pool.execute(
      `UPDATE payment_records pr JOIN orders o ON o.id = pr.order_id
       SET pr.provider_trade_no = COALESCE(:providerTradeNo, pr.provider_trade_no), pr.status = :status, pr.raw_payload = CAST(:payload AS JSON)
       WHERE o.order_no = :orderNo`,
      { orderNo, providerTradeNo: providerTradeNo || null, status, payload: JSON.stringify(req.body || {}) }
    );
    res.json({ ok: true, updated: result.affectedRows });
  } catch (error) {
    next(error);
  }
});

app.post("/api/comments", requireAuth, attachUser, async (req, res, next) => {
  try {
    const strategyId = Number(req.body?.strategyId);
    const blockedWords = await getActiveBlockedWords();
    const body = maskSensitiveText(String(req.body?.body || "").trim(), blockedWords);
    if (!body) return res.status(400).json({ ok: false, error: "评论不能为空" });
    await pool.execute("INSERT INTO comments (strategy_id, user_id, body, status) VALUES (:strategyId, :userId, :body, 'visible')", { strategyId, userId: req.user.id, body });
    res.json({ ok: true, bootstrap: await bootstrap(req.user.id) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/forum/posts", requireAuth, attachUser, async (req, res, next) => {
  try {
    const blockedWords = await getActiveBlockedWords();
    const category = String(req.body?.category || "general").trim();
    const title = maskSensitiveText(String(req.body?.title || "").trim(), blockedWords);
    const body = maskSensitiveText(String(req.body?.body || "").trim(), blockedWords);
    if (!forumCategoryIds.has(category)) return res.status(400).json({ ok: false, error: "交流区无效" });
    if (title.length < 2 || title.length > 160) return res.status(400).json({ ok: false, error: "帖子标题需要为 2-160 个字符" });
    if (body.length < 2) return res.status(400).json({ ok: false, error: "帖子内容不能为空" });
    await pool.execute("INSERT INTO forum_posts (user_id, category, title, body, status) VALUES (:userId, :category, :title, :body, 'visible')", { userId: req.user.id, category, title, body });
    res.json({ ok: true, bootstrap: await bootstrap(req.user.id) });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/forum/posts/:id", requireAuth, attachUser, async (req, res, next) => {
  try {
    const postId = Number(req.params.id);
    if (!postId) return res.status(400).json({ ok: false, error: "帖子参数无效" });
    const [[post]] = await pool.execute("SELECT id, user_id FROM forum_posts WHERE id = :postId AND status = 'visible' LIMIT 1", { postId });
    if (!post) return res.status(404).json({ ok: false, error: "帖子不存在或已删除" });
    if (Number(post.user_id) !== Number(req.user.id) && req.user.role !== "admin") return res.status(403).json({ ok: false, error: "不能删除其他用户的帖子" });
    await pool.execute("UPDATE forum_posts SET status = 'hidden' WHERE id = :postId", { postId });
    res.json({ ok: true, bootstrap: await bootstrap(req.user.id) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/forum/replies", requireAuth, attachUser, async (req, res, next) => {
  try {
    const postId = Number(req.body?.postId);
    const blockedWords = await getActiveBlockedWords();
    const body = maskSensitiveText(String(req.body?.body || "").trim(), blockedWords);
    if (!postId || !body) return res.status(400).json({ ok: false, error: "回复内容不能为空" });
    const [[post]] = await pool.execute("SELECT id FROM forum_posts WHERE id = :postId AND status = 'visible' LIMIT 1", { postId });
    if (!post) return res.status(404).json({ ok: false, error: "帖子不存在或已隐藏" });
    await pool.execute("INSERT INTO forum_replies (post_id, user_id, body, status) VALUES (:postId, :userId, :body, 'visible')", { postId, userId: req.user.id, body });
    res.json({ ok: true, bootstrap: await bootstrap(req.user.id) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/profile/avatar", requireAuth, attachUser, async (req, res, next) => {
  try {
    const avatarUrl = String(req.body?.avatarUrl || "").trim();
    if (!avatarUrl.startsWith("/uploads/images/")) return res.status(400).json({ ok: false, error: "头像地址无效" });
    await pool.execute("UPDATE users SET avatar_url = :avatarUrl WHERE id = :userId", { avatarUrl, userId: req.user.id });
    res.json({ ok: true, bootstrap: await bootstrap(req.user.id) });
  } catch (error) {
    next(error);
  }
});
app.post("/api/profile/name", requireAuth, attachUser, async (req, res, next) => {
  try {
    const displayName = String(req.body?.displayName || "").trim();
    if (displayName.length < 2 || displayName.length > 30) return res.status(400).json({ ok: false, error: "用户名长度需要为 2-30 个字符" });
    await pool.execute("UPDATE users SET display_name = :displayName WHERE id = :userId", { displayName, userId: req.user.id });
    res.json({ ok: true, bootstrap: await bootstrap(req.user.id) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/profile/email/send-code", requireAuth, attachUser, async (req, res, next) => {
  try {
    if (req.user.email) throw httpError(400, "邮箱已绑定，不能自行修改");
    const email = normalizeEmail(req.body?.email);
    assertEmail(email);
    await assertEmailAvailable(email, req.user.id);
    await assertEmailCodeCooldown({ email, purpose: "bind", userId: req.user.id });
    await createEmailVerificationCode({ email, purpose: "bind", userId: req.user.id });
    res.json({ ok: true });
  } catch (error) {
    if (error.code === "EAUTH" || error.code === "ECONNECTION" || error.code === "ETIMEDOUT") return res.status(500).json({ ok: false, error: "邮件发送失败，请检查 SMTP 配置" });
    next(error);
  }
});

app.post("/api/profile/email/bind", requireAuth, attachUser, async (req, res, next) => {
  try {
    if (req.user.email) throw httpError(400, "邮箱已绑定，不能自行修改");
    const email = normalizeEmail(req.body?.email);
    const code = String(req.body?.code || "").trim();
    assertEmail(email);
    if (!code) return res.status(400).json({ ok: false, error: "请输入邮箱验证码" });
    await assertEmailAvailable(email, req.user.id);
    await verifyEmailVerificationCode({ email, purpose: "bind", userId: req.user.id, code });
    await pool.execute("UPDATE users SET username = :email, email = :email, email_verified_at = NOW() WHERE id = :userId", { email, userId: req.user.id });
    res.json({ ok: true, bootstrap: await bootstrap(req.user.id) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/strategies", requireAuth, attachUser, async (req, res, next) => {
  try {
    const title = String(req.body?.title || "").trim();
    const description = String(req.body?.desc || "").trim();
    const tradeType = String(req.body?.type || "other");
    const platform = String(req.body?.platform || "").trim();
    const billingMode = String(req.body?.billingMode || "one_time");
    const sellerContact = String(req.body?.sellerContact || "").trim();
    const rawPrice = req.body?.price;
    const price = Number(rawPrice);
    if (!["one_time", "subscription"].includes(billingMode)) {
      return res.status(400).json({ ok: false, error: "收费方式无效" });
    }
    if (!title || !description || !platform || !sellerContact || rawPrice === undefined || rawPrice === "" || !Number.isFinite(price) || price < 0) {
      return res.status(400).json({ ok: false, error: "策略名称、平台、定价、联系方式和简介不能为空" });
    }
    const programFile = req.body?.programFile;
    if (!programFile?.url || !programFile?.originalName) {
      return res.status(400).json({ ok: false, error: "请先上传策略编译后程序文件" });
    }
    const riskLevel = ["crypto", "futures"].includes(tradeType) ? "high" : "medium";
    const [result] = await pool.execute(
      `INSERT INTO strategies (owner_id, title, description, trade_type, platform, symbol_scope, price, billing_mode, seller_contact, risk_level, status)
       VALUES (:ownerId, :title, :description, :tradeType, :platform, '用户自定义品种', :price, :billingMode, :sellerContact, :riskLevel, 'pending_review')`,
      { ownerId: req.user.id, title, description, tradeType, platform, price, billingMode, sellerContact, riskLevel }
    );
    const strategyId = result.insertId;
    const imageTypeMap = { cover: "cover", backtest: "backtest", data: "data_chart" };
    for (const [key, imageUrl] of Object.entries(req.body?.images || {})) {
      if (!imageUrl || !imageTypeMap[key]) continue;
      await pool.execute("INSERT INTO strategy_images (strategy_id, image_type, image_url, sort_order) VALUES (?, ?, ?, ?)", [strategyId, imageTypeMap[key], imageUrl, key === "cover" ? 1 : key === "backtest" ? 2 : 3]);
    }
    await pool.execute(
      "INSERT INTO strategy_files (strategy_id, file_type, original_name, file_url, file_size, mime_type) VALUES (:strategyId, 'compiled_program', :originalName, :url, :size, :mimetype)",
      { strategyId, originalName: programFile.originalName, url: programFile.url, size: Number(programFile.size || 0), mimetype: programFile.mimetype || null }
    );
    res.json({ ok: true, strategyId, bootstrap: await bootstrap(req.user.id) });
  } catch (error) {
    next(error);
  }
});

app.put("/api/strategies/:id", requireAuth, attachUser, async (req, res, next) => {
  const strategyId = Number(req.params.id);
  const conn = await pool.getConnection();
  try {
    const title = String(req.body?.title || "").trim();
    const description = String(req.body?.desc || "").trim();
    const tradeType = String(req.body?.type || "other");
    const platform = String(req.body?.platform || "").trim();
    const billingMode = String(req.body?.billingMode || "one_time");
    const sellerContact = String(req.body?.sellerContact || "").trim();
    const rawPrice = req.body?.price;
    const price = Number(rawPrice);
    if (!["one_time", "subscription"].includes(billingMode)) {
      return res.status(400).json({ ok: false, error: "收费方式无效" });
    }
    if (!title || !description || !platform || !sellerContact || rawPrice === undefined || rawPrice === "" || !Number.isFinite(price) || price < 0) {
      return res.status(400).json({ ok: false, error: "策略名称、平台、定价、联系方式和简介不能为空" });
    }
    await conn.beginTransaction();
    const [[strategy]] = await conn.execute("SELECT owner_id FROM strategies WHERE id = ? FOR UPDATE", [strategyId]);
    if (!strategy) {
      await conn.rollback();
      return res.status(404).json({ ok: false, error: "策略不存在" });
    }
    if (strategy.owner_id !== req.user.id) {
      await conn.rollback();
      return res.status(403).json({ ok: false, error: "只能编辑自己的策略" });
    }
    const riskLevel = ["crypto", "futures"].includes(tradeType) ? "high" : "medium";
    await conn.execute(
      `UPDATE strategies
       SET title = ?, description = ?, trade_type = ?, platform = ?, price = ?, billing_mode = ?, seller_contact = ?, risk_level = ?, status = 'pending_review', owner_deleted_at = NULL
       WHERE id = ?`,
      [title, description, tradeType, platform, price, billingMode, sellerContact, riskLevel, strategyId]
    );
    const imageTypeMap = { cover: "cover", backtest: "backtest", data: "data_chart" };
    for (const [key, imageUrl] of Object.entries(req.body?.images || {})) {
      if (!imageUrl || !imageTypeMap[key]) continue;
      await conn.execute("DELETE FROM strategy_images WHERE strategy_id = ? AND image_type = ?", [strategyId, imageTypeMap[key]]);
      await conn.execute("INSERT INTO strategy_images (strategy_id, image_type, image_url, sort_order) VALUES (?, ?, ?, ?)", [strategyId, imageTypeMap[key], imageUrl, key === "cover" ? 1 : key === "backtest" ? 2 : 3]);
    }
    const programFile = req.body?.programFile;
    if (programFile?.url && programFile?.originalName) {
      await conn.execute(
        "INSERT INTO strategy_files (strategy_id, file_type, original_name, file_url, file_size, mime_type) VALUES (?, 'compiled_program', ?, ?, ?, ?)",
        [strategyId, programFile.originalName, programFile.url, Number(programFile.size || 0), programFile.mimetype || null]
      );
    }
    await conn.commit();
    res.json({ ok: true, strategyId, bootstrap: await bootstrap(req.user.id) });
  } catch (error) {
    await conn.rollback();
    next(error);
  } finally {
    conn.release();
  }
});

app.post("/api/uploads", requireAuth, attachUser, imageUpload.single("image"), (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: "请上传图片文件" });
  res.json({ ok: true, file: { url: `/uploads/images/${req.file.filename}`, filename: req.file.filename, originalName: requestUploadOriginalName(req), mimetype: req.file.mimetype, size: req.file.size } });
});

app.post("/api/strategy-files", requireAuth, attachUser, programUpload.single("program"), (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: "请上传 .ex4、.ex5、.zip、.dll 或 .set 文件" });
  res.json({ ok: true, file: { url: `/uploads/strategy-files/${req.file.filename}`, filename: req.file.filename, originalName: requestUploadOriginalName(req), mimetype: req.file.mimetype, size: req.file.size } });
});

app.delete("/api/strategies/:id", requireAuth, attachUser, async (req, res, next) => {
  try {
    const strategyId = Number(req.params.id);
    const [[strategy]] = await pool.execute("SELECT owner_id, status FROM strategies WHERE id = :strategyId LIMIT 1", { strategyId });
    if (!strategy) return res.status(404).json({ ok: false, error: "策略不存在" });
    if (strategy.owner_id !== req.user.id) return res.status(403).json({ ok: false, error: "只能删除自己的策略" });
    if (strategy.status !== "unlisted") return res.status(400).json({ ok: false, error: "只有已下架策略可以删除" });
    await pool.execute("UPDATE strategies SET owner_deleted_at = NOW() WHERE id = :strategyId", { strategyId });
    res.json({ ok: true, bootstrap: await bootstrap(req.user.id) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/strategies/:id/download", requireAuth, attachUser, async (req, res, next) => {
  try {
    const strategyId = Number(req.params.id);
    const [permissionRows] = await pool.execute(
      `SELECT s.owner_id,
        EXISTS (SELECT 1 FROM orders o WHERE o.strategy_id = s.id AND o.buyer_id = :userId AND o.status = 'paid') AS purchased
       FROM strategies s WHERE s.id = :strategyId LIMIT 1`,
      { userId: req.user.id, strategyId }
    );
    const permission = permissionRows[0];
    if (!permission || !(req.user.role === "admin" || permission.owner_id === req.user.id || permission.purchased)) return res.status(403).json({ ok: false, error: "购买后才可以下载策略文件" });
    const [rows] = await pool.execute("SELECT original_name, file_url FROM strategy_files WHERE strategy_id = :strategyId AND file_type = 'compiled_program' ORDER BY created_at DESC, id DESC LIMIT 1", { strategyId });
    const file = rows[0];
    if (!file) return res.status(404).json({ ok: false, error: "该策略还没有上传程序文件" });
    const absolutePath = path.resolve(__dirname, `.${file.file_url}`);
    if (!absolutePath.startsWith(uploadRoot) || !fs.existsSync(absolutePath)) return res.status(404).json({ ok: false, error: "策略文件不存在" });
    res.download(absolutePath, file.original_name);
  } catch (error) {
    next(error);
  }
});

app.post("/api/strategy-status", requireAuth, attachUser, async (req, res, next) => {
  try {
    const strategyId = Number(req.body?.strategyId);
    const status = String(req.body?.status || "");
    if (!["listed", "unlisted", "pending_review", "rejected"].includes(status)) return res.status(400).json({ ok: false, error: "状态无效" });
    const [[strategy]] = await pool.execute("SELECT owner_id FROM strategies WHERE id = ?", [strategyId]);
    if (!strategy) return res.status(404).json({ ok: false, error: "策略不存在" });
    if (strategy.owner_id !== req.user.id && req.user.role !== "admin") return res.status(403).json({ ok: false, error: "只能管理自己的策略" });
    if (req.user.role !== "admin" && status === "listed") return res.status(403).json({ ok: false, error: "策略上架需要管理员审核通过" });
    await pool.execute("UPDATE strategies SET status = ? WHERE id = ?", [status, strategyId]);
    res.json({ ok: true, bootstrap: await bootstrap(req.user.id) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/strategy-status", requireAuth, attachUser, requireAdmin, async (req, res, next) => {
  try {
    const strategyId = Number(req.body?.strategyId);
    const status = String(req.body?.status || "");
    if (!["listed", "unlisted", "pending_review", "rejected"].includes(status)) return res.status(400).json({ ok: false, error: "状态无效" });
    await pool.execute("UPDATE strategies SET status = ? WHERE id = ?", [status, strategyId]);
    await writeAudit(req.user.id, "update_strategy_status", "strategy", strategyId, { status });
    res.json({ ok: true, bootstrap: await bootstrap(req.user.id) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/blocked-words", requireAuth, attachUser, requireAdmin, async (req, res, next) => {
  try {
    const word = String(req.body?.word || "").trim();
    if (word.length < 1 || word.length > 120) return res.status(400).json({ ok: false, error: "屏蔽词长度需要为 1-120 个字符" });
    await pool.execute(
      `INSERT INTO blocked_words (word, status, created_by)
       VALUES (:word, 'active', :adminId)
       ON DUPLICATE KEY UPDATE status = 'active'`,
      { word, adminId: req.user.id }
    );
    await writeAudit(req.user.id, "add_blocked_word", "blocked_word", null, { word });
    res.json({ ok: true, bootstrap: await bootstrap(req.user.id) });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/admin/blocked-words/:id", requireAuth, attachUser, requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ ok: false, error: "屏蔽词不存在" });
    await pool.execute("DELETE FROM blocked_words WHERE id = :id", { id });
    await writeAudit(req.user.id, "delete_blocked_word", "blocked_word", id, {});
    res.json({ ok: true, bootstrap: await bootstrap(req.user.id) });
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(error.status || 500).json({ ok: false, error: error.message || "服务器错误" });
});

await ensureSchema();

app.listen(port, "127.0.0.1", () => {
  console.log(`EA Strategy demo server running at http://127.0.0.1:${port}/index.html`);
  console.log(`Admin portal running at http://127.0.0.1:${port}/admin.html`);
});







