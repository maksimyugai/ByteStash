import Logger from '../logger.js';
import { generateHex } from './userRepository.js';

export interface ApiKeyRow {
  id: number;
  name: string;
  created_at: string;
  last_used_at: string | null;
  is_active: number;
}

export class ApiKeyRepository {
  constructor(private db: D1Database) {}

  async createApiKey(userId: number, name: string) {
    const key = generateHex(32);

    try {
      const row = await this.db
        .prepare('INSERT INTO api_keys (user_id, key, name) VALUES (?, ?, ?) RETURNING id')
        .bind(userId, key, name)
        .first<{ id: number }>();

      if (!row) return null;
      Logger.debug(`Created new API key for user ${userId}`);
      return {
        id: row.id,
        key,
        name,
        created_at: new Date().toISOString(),
        is_active: true,
      };
    } catch (error) {
      Logger.error('Error creating API key:', error);
      throw error;
    }
  }

  async getApiKeys(userId: number): Promise<ApiKeyRow[]> {
    try {
      const { results } = await this.db
        .prepare(
          `SELECT id, name, created_at, last_used_at, is_active
           FROM api_keys WHERE user_id = ? ORDER BY created_at DESC`
        )
        .bind(userId)
        .all<ApiKeyRow>();
      return results;
    } catch (error) {
      Logger.error('Error fetching API keys:', error);
      throw error;
    }
  }

  async deleteApiKey(userId: number, keyId: number | string): Promise<boolean> {
    try {
      const result = await this.db
        .prepare('DELETE FROM api_keys WHERE id = ? AND user_id = ?')
        .bind(keyId, userId)
        .run();
      const deleted = (result.meta.changes ?? 0) === 1;
      if (deleted) Logger.debug(`Deleted API key ${keyId} for user ${userId}`);
      return deleted;
    } catch (error) {
      Logger.error('Error deleting API key:', error);
      throw error;
    }
  }

  async validateApiKey(key: string): Promise<{ userId: number; keyId: number } | null> {
    try {
      const apiKey = await this.db
        .prepare(
          `SELECT ak.id, ak.user_id
           FROM api_keys ak
           JOIN users u ON ak.user_id = u.id
           WHERE ak.key = ? AND ak.is_active = TRUE`
        )
        .bind(key)
        .first<{ id: number; user_id: number }>();

      if (!apiKey) return null;

      await this.db
        .prepare('UPDATE api_keys SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?')
        .bind(apiKey.id)
        .run();

      Logger.debug(`Validated API key ${apiKey.id} for user ${apiKey.user_id}`);
      return { userId: apiKey.user_id, keyId: apiKey.id };
    } catch (error) {
      Logger.error('Error validating API key:', error);
      throw error;
    }
  }
}
