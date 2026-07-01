USE ea_strategy_demo;

INSERT INTO users (id, username, email, email_verified_at, password_hash, display_name, role, balance, status)
VALUES
  (1, 'demo', 'demo@local.test', NOW(), '$2a$10$.EBFN5Doy8vCcluaDcsYfeXM8i7b3Z1JQAHXkEFJHeyQ22qeE.8j6', 'Strategy Buyer', 'user', 12880.00, 'active'),
  (2, 'admin', NULL, NULL, 'RESET_REQUIRED_USE_scripts_reset-admin-password.mjs', 'System Admin', 'admin', 0.00, 'active'),
  (3, 'quantmason', 'quantmason@local.test', NOW(), '$2a$10$CfzBPBQ3hMCuOQHNxqcD4uf9PF4.KJzj8kWNF3DIyxyNI6q1tFVQ.', 'QuantMason', 'user', 4200.00, 'active'),
  (4, 'blockalpha', 'blockalpha@local.test', NOW(), '$2a$10$CfzBPBQ3hMCuOQHNxqcD4uf9PF4.KJzj8kWNF3DIyxyNI6q1tFVQ.', 'BlockAlpha', 'user', 6800.00, 'active'),
  (5, 'futureslab', 'futureslab@local.test', NOW(), '$2a$10$CfzBPBQ3hMCuOQHNxqcD4uf9PF4.KJzj8kWNF3DIyxyNI6q1tFVQ.', 'FuturesLab', 'user', 5300.00, 'active');

INSERT INTO strategies (
  id, owner_id, title, description, trade_type, platform, symbol_scope,
  price, billing_mode, seller_contact, volume, risk_level, status
)
VALUES
  (1, 3, 'MultiCycle ATR Filter EA', 'Multi-cycle ATR trend filter for medium-frequency XAUUSD and EURUSD trading.', 'forex_ea', 'MT5', 'XAUUSD / EURUSD', 1299.00, 'one_time', 'quantmason@example.com', 2386, 'medium', 'listed'),
  (2, 4, 'BTC Funding Momentum', 'Crypto momentum strategy using funding rate and order book signals.', 'crypto', 'Binance API', 'BTCUSDT / ETHUSDT', 899.00, 'subscription', 'blockalpha@example.com', 3112, 'high', 'listed'),
  (3, 5, 'IF Futures Intraday Grid', 'Intraday futures grid strategy with volatility stop-loss controls.', 'futures', 'CTP', 'IF / IH / IC', 1680.00, 'one_time', 'futureslab@example.com', 1468, 'medium_high', 'listed'),
  (4, 1, 'US Index Rotation', 'US index rotation strategy with moving-average signal filters.', 'index', 'TradingView', 'NASDAQ / S&P 500', 699.00, 'one_time', 'demo@local.test', 987, 'medium', 'pending_review');

INSERT INTO comments (strategy_id, user_id, parent_id, body, status)
VALUES
  (1, 1, NULL, 'The backtest chart is clear. Please add 2025 sideways-market results.', 'visible'),
  (1, 3, 1, 'Sideways-market chart has been added. Please test with a small lot first.', 'visible'),
  (2, 4, NULL, 'API connection examples are available after purchase.', 'visible'),
  (3, 1, NULL, 'Please clarify the CTP version and minimum capital requirement.', 'visible');

INSERT INTO orders (id, order_no, buyer_id, strategy_id, amount, status, paid_at)
VALUES
  (1, 'ORD20260629001', 1, 1, 1299.00, 'paid', '2026-06-29 10:42:00');

INSERT INTO payment_records (order_id, provider, provider_trade_no, amount, status, raw_payload)
VALUES
  (1, 'demo_pay', 'PAY20260629001', 1299.00, 'verified', JSON_OBJECT('source', 'seed', 'verified', true));

INSERT INTO account_ledger (user_id, order_id, entry_type, amount, balance_after, description)
VALUES
  (1, 1, 'purchase', -1299.00, 12880.00, 'Purchase MultiCycle ATR Filter EA'),
  (1, NULL, 'recharge', 5000.00, 14179.00, 'Account recharge'),
  (1, NULL, 'sale_income', 489.00, 12880.00, 'US Index Rotation pending settlement');

INSERT INTO system_settings (setting_key, setting_value, description)
VALUES
  ('official_wechat', 'WX-ADMIN-888', 'Official WeChat shown on the post-purchase help page'),
  ('payment_provider', 'demo_pay', 'Current payment provider placeholder'),
  ('platform_fee_rate', '0.20', 'Platform fee rate');

INSERT INTO admin_audit_logs (admin_id, action, target_type, target_id, detail)
VALUES
  (2, 'approve_strategy', 'strategy', 1, JSON_OBJECT('status', 'listed')),
  (2, 'update_setting', 'system_settings', NULL, JSON_OBJECT('key', 'official_wechat'));

