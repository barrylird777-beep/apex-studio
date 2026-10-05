import { createHash } from 'node:crypto';

export class TitanConcurrencyLock {
  constructor(pool) {
    this.pool = pool;
  }

  generateLockId(filePath) {
    const digest = createHash('sha256').update(String(filePath)).digest();
    return digest.readInt32BE(0);
  }

  async executeWithLock(absoluteFilePath, operation) {
    const client = await this.pool.connect();
    const lockId = this.generateLockId(absoluteFilePath);
    let operationError;
    try {
      await client.query('SELECT pg_advisory_lock($1)', [lockId]);
      try {
        return await operation();
      } catch (error) {
        operationError = error;
        throw error;
      } finally {
        try {
          await client.query('SELECT pg_advisory_unlock($1)', [lockId]);
        } catch (unlockError) {
          if (!operationError) throw unlockError;
        }
      }
    } finally {
      client.release();
    }
  }
}
