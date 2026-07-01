# Backend

The demo now runs on Node.js + Express + mysql2.

## Start

```powershell
cd "C:\Users\13950\Desktop\ea web demo"
powershell -ExecutionPolicy Bypass -File ".\start-app.ps1"
```

Open:

```text
http://127.0.0.1:5173/index.html
http://127.0.0.1:5173/admin.html
```

## Login

User accounts are created from the registration page.

Admin accounts must use the separate admin portal and should have their password reset locally:

```powershell
node scripts/reset-admin-password.mjs admin "your-strong-password"
```

Passwords are stored as bcrypt hashes in `users.password_hash`. Do not put admin passwords in frontend code or docs.

## Main API

- `POST /api/login`: user login only, returns user profile and JWT.
- `POST /api/admin/login`: admin login only, returns admin profile and JWT.
- `POST /api/register`: creates a normal user account and returns JWT.
- `GET /api/bootstrap`: returns current user, strategies, comments and ledger. Requires JWT.
- `POST /api/purchase`: creates paid order, payment record, ledger entry and increments strategy volume. Requires JWT.
- `POST /api/comments`: creates a strategy comment. Requires JWT.
- `POST /api/strategies`: creates a pending-review strategy. Requires JWT.
- `POST /api/uploads`: uploads one strategy image through multer. Requires JWT.
- `POST /api/strategy-files`: uploads one compiled strategy file such as `.ex5`/`.ex4`/`.zip`. Requires JWT.
- `GET /api/strategies/:id/download`: downloads the compiled strategy file after purchase, owner access, or admin access. Requires JWT.
- `POST /api/strategy-status`: owner or admin status update. Requires JWT.
- `POST /api/admin/strategy-status`: admin-only strategy status update with audit log.
- `POST /api/payments/callback`: payment callback placeholder.

## Environment

The local `.env` contains MySQL connection settings and JWT secret. `.env.example` documents the required variables.

