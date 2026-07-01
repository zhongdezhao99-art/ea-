CREATE DATABASE IF NOT EXISTS ea_strategy_demo
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;

USE ea_strategy_demo;

SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS admin_audit_logs;
DROP TABLE IF EXISTS system_settings;
DROP TABLE IF EXISTS account_ledger;
DROP TABLE IF EXISTS payment_records;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS forum_replies;
DROP TABLE IF EXISTS forum_posts;
DROP TABLE IF EXISTS blocked_words;
DROP TABLE IF EXISTS comments;
DROP TABLE IF EXISTS strategy_files;
DROP TABLE IF EXISTS strategy_images;
DROP TABLE IF EXISTS strategies;
DROP TABLE IF EXISTS users;

SET FOREIGN_KEY_CHECKS = 1;

CREATE TABLE users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  username VARCHAR(191) NOT NULL,
  email VARCHAR(191) NULL,
  email_verified_at DATETIME NULL,
  password_hash VARCHAR(255) NOT NULL,
  display_name VARCHAR(80) NOT NULL,
  avatar_url VARCHAR(500) NULL,
  role ENUM('user', 'admin') NOT NULL DEFAULT 'user',
  balance DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  status ENUM('active', 'disabled') NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_users_username (username),
  UNIQUE KEY uk_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE email_verification_codes (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  email VARCHAR(191) NOT NULL,
  purpose ENUM('register', 'bind', 'reset') NOT NULL,
  user_id BIGINT UNSIGNED NULL,
  code_hash VARCHAR(255) NOT NULL,
  attempts INT UNSIGNED NOT NULL DEFAULT 0,
  expires_at DATETIME NOT NULL,
  used_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_email_codes_lookup (email, purpose, created_at),
  KEY idx_email_codes_user (user_id),
  CONSTRAINT fk_email_codes_user
    FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE strategies (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  owner_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(160) NOT NULL,
  description TEXT NOT NULL,
  trade_type ENUM('forex_ea', 'futures', 'crypto', 'stock', 'index', 'cfd', 'other') NOT NULL,
  platform VARCHAR(120) NOT NULL,
  symbol_scope VARCHAR(160) NOT NULL,
  price DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  billing_mode ENUM('one_time', 'subscription') NOT NULL DEFAULT 'one_time',
  seller_contact VARCHAR(160) NOT NULL DEFAULT '',
  volume INT UNSIGNED NOT NULL DEFAULT 0,
  risk_level ENUM('low', 'medium', 'medium_high', 'high') NOT NULL DEFAULT 'medium',
  status ENUM('draft', 'pending_review', 'listed', 'unlisted', 'rejected') NOT NULL DEFAULT 'pending_review',
  owner_deleted_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_strategies_market_rank (status, volume DESC, created_at DESC),
  KEY idx_strategies_type (trade_type),
  KEY idx_strategies_owner (owner_id),
  CONSTRAINT fk_strategies_owner
    FOREIGN KEY (owner_id) REFERENCES users(id)
    ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE strategy_images (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  strategy_id BIGINT UNSIGNED NOT NULL,
  image_type ENUM('cover', 'backtest', 'data_chart', 'description') NOT NULL,
  image_url VARCHAR(500) NOT NULL,
  sort_order INT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_strategy_images_strategy (strategy_id, image_type),
  CONSTRAINT fk_strategy_images_strategy
    FOREIGN KEY (strategy_id) REFERENCES strategies(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE strategy_files (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  strategy_id BIGINT UNSIGNED NOT NULL,
  file_type ENUM('compiled_program', 'source', 'document') NOT NULL DEFAULT 'compiled_program',
  original_name VARCHAR(255) NOT NULL,
  file_url VARCHAR(500) NOT NULL,
  file_size BIGINT UNSIGNED NOT NULL DEFAULT 0,
  mime_type VARCHAR(120) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_strategy_files_strategy (strategy_id, file_type),
  CONSTRAINT fk_strategy_files_strategy
    FOREIGN KEY (strategy_id) REFERENCES strategies(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE comments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  strategy_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  parent_id BIGINT UNSIGNED NULL,
  body TEXT NOT NULL,
  status ENUM('visible', 'hidden', 'reported') NOT NULL DEFAULT 'visible',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_comments_strategy (strategy_id, created_at),
  KEY idx_comments_user (user_id),
  KEY idx_comments_parent (parent_id),
  CONSTRAINT fk_comments_strategy
    FOREIGN KEY (strategy_id) REFERENCES strategies(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_comments_user
    FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_comments_parent
    FOREIGN KEY (parent_id) REFERENCES comments(id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE blocked_words (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE forum_posts (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE forum_replies (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE orders (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_no VARCHAR(64) NOT NULL,
  buyer_id BIGINT UNSIGNED NOT NULL,
  strategy_id BIGINT UNSIGNED NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  status ENUM('pending', 'paid', 'cancelled', 'refunded') NOT NULL DEFAULT 'pending',
  paid_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_orders_order_no (order_no),
  UNIQUE KEY uk_orders_buyer_strategy_paid (buyer_id, strategy_id, status),
  KEY idx_orders_buyer (buyer_id, created_at),
  KEY idx_orders_strategy (strategy_id),
  CONSTRAINT fk_orders_buyer
    FOREIGN KEY (buyer_id) REFERENCES users(id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_orders_strategy
    FOREIGN KEY (strategy_id) REFERENCES strategies(id)
    ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE payment_records (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id BIGINT UNSIGNED NOT NULL,
  provider VARCHAR(50) NOT NULL,
  provider_trade_no VARCHAR(128) NULL,
  amount DECIMAL(12,2) NOT NULL,
  status ENUM('created', 'callback_received', 'verified', 'failed') NOT NULL DEFAULT 'created',
  raw_payload JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_payment_records_order (order_id),
  KEY idx_payment_records_provider_trade (provider, provider_trade_no),
  CONSTRAINT fk_payment_records_order
    FOREIGN KEY (order_id) REFERENCES orders(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE account_ledger (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  order_id BIGINT UNSIGNED NULL,
  entry_type ENUM('recharge', 'purchase', 'sale_income', 'platform_fee', 'refund', 'adjustment') NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  balance_after DECIMAL(12,2) NOT NULL,
  description VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_account_ledger_user (user_id, created_at),
  KEY idx_account_ledger_order (order_id),
  CONSTRAINT fk_account_ledger_user
    FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_account_ledger_order
    FOREIGN KEY (order_id) REFERENCES orders(id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE system_settings (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  setting_key VARCHAR(100) NOT NULL,
  setting_value TEXT NOT NULL,
  description VARCHAR(255) NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_system_settings_key (setting_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE admin_audit_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  admin_id BIGINT UNSIGNED NOT NULL,
  action VARCHAR(80) NOT NULL,
  target_type VARCHAR(60) NOT NULL,
  target_id BIGINT UNSIGNED NULL,
  detail JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_admin_audit_logs_admin (admin_id, created_at),
  KEY idx_admin_audit_logs_target (target_type, target_id),
  CONSTRAINT fk_admin_audit_logs_admin
    FOREIGN KEY (admin_id) REFERENCES users(id)
    ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

