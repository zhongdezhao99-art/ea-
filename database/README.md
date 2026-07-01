# EA Strategy Demo Database

## Connection

```text
Host: 127.0.0.1
Port: 3306
Database: ea_strategy_demo
User: ea_app
Password: ea_app_123456
```

Root is a local development account with an empty password.

## Tables

- `users`: users and admins, including balance and account status.
- `strategies`: core strategy listing data, including owner, trade type, platform, price, billing mode, seller contact, volume, risk level and listing status.
- `strategy_images`: uploaded image records for cover, backtest, data chart and description images.
- `strategy_files`: compiled strategy files and other downloadable artifacts, such as EA `.ex5` files.
- `comments`: strategy comment threads and replies.
- `blocked_words`: admin-managed sensitive words used to mask forum and strategy comment content.
- `forum_posts`, `forum_replies`: community forum posts and replies shown above the strategy market.
- `orders`: purchase orders for strategies.
- `payment_records`: payment provider records and callback payloads.
- `account_ledger`: balance changes, purchases, sales income, fees, refunds and adjustments.
- `system_settings`: payment provider, official WeChat and platform fee settings.
- `admin_audit_logs`: admin operation history for review, settings and moderation actions.

## Main Relationships

- `strategies.owner_id -> users.id`
- `strategy_images.strategy_id -> strategies.id`
- `strategy_files.strategy_id -> strategies.id`
- `comments.strategy_id -> strategies.id`
- `comments.user_id -> users.id`
- `blocked_words.created_by -> users.id`
- `forum_posts.user_id -> users.id`
- `forum_replies.post_id -> forum_posts.id`
- `forum_replies.user_id -> users.id`
- `orders.buyer_id -> users.id`
- `orders.strategy_id -> strategies.id`
- `payment_records.order_id -> orders.id`
- `account_ledger.user_id -> users.id`
- `account_ledger.order_id -> orders.id`
- `admin_audit_logs.admin_id -> users.id`

## Rebuild

From PowerShell:

```powershell
Get-Content -LiteralPath "database\schema.sql" -Raw | mysql --host=127.0.0.1 --port=3306 --user=ea_app --password=ea_app_123456
Get-Content -LiteralPath "database\seed.sql" -Raw | mysql --host=127.0.0.1 --port=3306 --user=ea_app --password=ea_app_123456 --database=ea_strategy_demo
```

## Workbench

1. Open MySQL Workbench.
2. Click `+` next to `MySQL Connections`.
3. Fill in:
   - Connection Name: `EA Strategy Demo`
   - Hostname: `127.0.0.1`
   - Port: `3306`
   - Username: `ea_app`
4. Click `Store in Vault...` and enter `ea_app_123456`, or click `Test Connection` and enter the password when prompted.
5. Open the connection.
6. In the left `SCHEMAS` panel, click refresh.
7. Expand `ea_strategy_demo`.
8. Expand `Tables`.
9. Right-click any table and choose `Table Inspector` to see columns, indexes and foreign keys.
10. You can also right-click a table and choose `Select Rows - Limit 1000` to view data.

