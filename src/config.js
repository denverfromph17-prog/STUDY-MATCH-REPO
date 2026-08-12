import path from 'node:path';

export function getConfig(overrides = {}) {
  return {
    port: Number(process.env.PORT || 3000),
    databasePath: process.env.DATABASE_PATH || path.resolve('data/study-match.db'),
    uploadDir: process.env.UPLOAD_DIR || path.resolve('data/uploads/profile-photos'),
    isProduction: process.env.NODE_ENV === 'production',
    sessionDays: 7,
    matchMinimumScore: Number(process.env.MATCH_MINIMUM_SCORE || 40),
    matchLimit: Number(process.env.MATCH_LIMIT || 20),
    matchCandidateScanLimit: Number(process.env.MATCH_CANDIDATE_SCAN_LIMIT || 500),
    ...overrides,
  };
}
