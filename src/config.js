export const DEV_MODE =
  (import.meta.env.VITE_DEV_MODE ?? 'true') === 'true' ||
  !import.meta.env.VITE_FIREBASE_API_KEY

export const ADMIN_CODE = import.meta.env.VITE_ADMIN_CODE || 'repetitor2025'

export const APP_STORAGE_PREFIX = 'oge_hq_v1'
