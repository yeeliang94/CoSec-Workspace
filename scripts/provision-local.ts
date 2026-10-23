/** One-time credentials and isolated DB provision. No existing database is overwritten. */
import { randomBytes } from 'node:crypto';
import { access, writeFile, mkdir } from 'node:fs/promises';
import mysql from 'mysql2/promise';
await mkdir('.local', { recursive: true });
try {
  await access('.env');
  throw new Error('.env already exists; preserve it and configure manually.');
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}
const password = randomBytes(24).toString('hex');
const rootPassword = randomBytes(24).toString('hex');
const connection = await mysql.createConnection({
  socketPath: `${process.cwd()}/.local/mysql.sock`,
  user: 'root',
});
try {
  await connection.query('CREATE DATABASE cosec CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci');
  await connection.query(`CREATE USER 'cosec'@'127.0.0.1' IDENTIFIED BY '${password}'`);
  await connection.query(
    "GRANT SELECT,INSERT,UPDATE,DELETE,CREATE,ALTER,INDEX,REFERENCES ON cosec.* TO 'cosec'@'127.0.0.1'",
  );
  await connection.query(`ALTER USER 'root'@'localhost' IDENTIFIED BY '${rootPassword}'`);
  await writeFile(
    '.env',
    `DATABASE_URL=mysql://cosec:${password}@127.0.0.1:3307/cosec\nBETTER_AUTH_SECRET=${randomBytes(40).toString('hex')}\nBETTER_AUTH_URL=http://127.0.0.1:3000\nSTORAGE_DIR=.local/storage\nNEXT_TELEMETRY_DISABLED=1\n`,
    { mode: 0o600, flag: 'wx' },
  );
  await writeFile('.local/mysql-root-password', rootPassword + '\n', { mode: 0o600, flag: 'wx' });
  console.log('Created isolated database and private .env. Credentials were not printed.');
} finally {
  await connection.end();
}
