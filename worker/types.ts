export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  APP_ORIGIN: string;
  AUTH_SECRET: string;
  OWNER_EMAIL: string;
  ACCESS_REQUIRED: string;
  ACCESS_ISSUER: string;
  ACCESS_AUDIENCE: string;
  ADMIN_ACCESS_AUDIENCE: string;
  BUILD_ID?: string;
}
export interface Account {
  id: string;
  email: string;
  name: string;
  role: string;
}
