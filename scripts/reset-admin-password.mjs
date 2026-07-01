import "dotenv/config";
import bcrypt from "bcryptjs";
import mysql from "mysql2/promise";
import crypto from "node:crypto";

const account = process.argv[2] || "admin";
const password = process.argv[3] || crypto.randomBytes(18).toString("base64url");

const conn = await mysql.createConnection({
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "ea_app",
  password: process.env.DB_PASSWORD || "ea_app_123456",
  database: process.env.DB_NAME || "ea_strategy_demo",
  charset: "utf8mb4",
});

const passwordHash = await bcrypt.hash(password, 10);
const [result] = await conn.execute(
  "UPDATE users SET password_hash = ?, status = 'active' WHERE username = ? AND role = 'admin'",
  [passwordHash, account]
);
await conn.end();

if (result.affectedRows !== 1) {
  throw new Error(`Admin account not found: ${account}`);
}

console.log(JSON.stringify({ account, password }, null, 2));
