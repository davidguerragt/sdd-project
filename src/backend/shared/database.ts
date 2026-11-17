import { DataSource } from 'typeorm';
import { entities } from './entities';

export const database = new DataSource({
  type: 'mysql',
  host: process.env.DB_HOST ?? '127.0.0.1',
  port: Number(process.env.DB_PORT ?? 3306),
  username: process.env.DB_USER ?? 'payflex',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME ?? 'payflex',
  entities,
  synchronize: process.env.DB_SYNCHRONIZE === 'true',
  logging: false,
  charset: 'utf8mb4',
  timezone: 'Z',
  extra: { connectionLimit: 20 },
});