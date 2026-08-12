import path from 'node:path';

export function getConfig(overrides = {}) {
  return {
    port: Number(process.env.PORT || 3000),
    databasePath: process.env.DATABASE_PATH || path.resolve('data/study-match.db'),
    uploadDir: process.env.UPLOAD_DIR || path.resolve('data/uploads/profile-photos'),
    isProduction: process.env.NODE_ENV === 'production',
    sessionDays: 7,
    ...overrides,
  };
}
