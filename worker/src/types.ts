export interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
  ASSETS: Fetcher;

  DEBUG?: string;
  DISABLE_ACCOUNTS?: string;
  ADMIN_USERNAMES?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  DEV_AUTH?: string;
}

export interface AuthUser {
  id: number;
  username: string;
  created_at?: string;
  email?: string | null;
  name?: string | null;
  oidc_id?: string | null;
  is_admin?: number | boolean;
  is_active?: number | boolean;
}

/** Hono generic: bindings + per-request variables. */
export type AppEnv = {
  Bindings: Env;
  Variables: {
    user: AuthUser;
    apiKey?: { id: number };
  };
};

export interface Fragment {
  id?: number;
  file_name: string;
  code: string;
  language: string;
  position: number;
}

export interface SnippetInput {
  title: string;
  description?: string;
  categories?: string[];
  fragments?: Fragment[];
  isPublic?: number | boolean;
}

export interface SnippetFilters {
  search?: string | null;
  searchCode?: boolean;
  language?: string | null;
  categories?: string[] | null;
  favorites?: boolean;
  pinned?: boolean;
  recycled?: boolean;
}
