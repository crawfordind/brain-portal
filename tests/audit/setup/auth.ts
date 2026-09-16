import { createClient } from '@libsql/client'
import { randomBytes, createHash } from 'crypto'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

export const SESSION_COOKIE_NAME = 'brain_session'

function generateToken(): string {
  return randomBytes(32).toString('hex')
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export async function createTestSession(): Promise<{
  rawToken: string
  userId: string
  cleanup: () => Promise<void>
}> {
  const db = createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN,
  })

  const result = await db.execute('SELECT id, email FROM users LIMIT 1')
  if (result.rows.length === 0) {
    throw new Error(
      'No users found in DB. Log in once via the app to create a user account.'
    )
  }

  const userId = result.rows[0].id as string
  const rawToken = generateToken()
  const hashedToken = hashToken(rawToken)
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString()

  await db.execute({
    sql: 'INSERT INTO sessions (user_id, token, expires_at) VALUES (?, ?, ?)',
    args: [userId, hashedToken, expiresAt],
  })

  const cleanup = async () => {
    await db.execute({
      sql: 'DELETE FROM sessions WHERE token = ?',
      args: [hashedToken],
    })
    db.close()
  }

  return { rawToken, userId, cleanup }
}
