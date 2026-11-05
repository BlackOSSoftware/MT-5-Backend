import admin from 'firebase-admin'
import fs from 'fs'
import path from 'path'

const serviceAccountPath = path.join(
  process.cwd(),
  'firebase-admin-key.json'
)

if (!fs.existsSync(serviceAccountPath)) {
  throw new Error('Firebase service account key not found')
}

const serviceAccount = JSON.parse(
  fs.readFileSync(serviceAccountPath, 'utf-8')
)

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
})

/**
 * Optional second Firebase project for the mobile app (its google-services.json
 * points to a different project than the web portal). Tokens from that project
 * must be sent with that project's credentials.
 */
const appKeyPath = path.resolve(
  process.cwd(),
  process.env.FIREBASE_APP_KEY_PATH || 'firebase-admin-key-app.json'
)

let appMessaging = null
if (fs.existsSync(appKeyPath)) {
  try {
    const appAccount = JSON.parse(fs.readFileSync(appKeyPath, 'utf-8'))
    const mobileApp = admin.initializeApp(
      { credential: admin.credential.cert(appAccount) },
      'mobile-app'
    )
    appMessaging = mobileApp.messaging()
    console.log(`[FIREBASE] mobile app project loaded: ${appAccount.project_id}`)
  } catch (err) {
    console.error('[FIREBASE] mobile app key invalid:', err?.message || err)
  }
}

/** Messaging client for the mobile app's Firebase project, or null if not configured. */
export function getAppMessaging() {
  return appMessaging
}

export default admin
