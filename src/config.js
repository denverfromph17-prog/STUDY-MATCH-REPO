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
    chatMaxMessageLength: Number(process.env.CHAT_MAX_MESSAGE_LENGTH || 2000),
    chatDefaultPageSize: Number(process.env.CHAT_DEFAULT_PAGE_SIZE || 50),
    chatMaxPageSize: Number(process.env.CHAT_MAX_PAGE_SIZE || 100),
    chatMessageRateLimit: Number(process.env.CHAT_MESSAGE_RATE_LIMIT || 30),
    ...overrides,
  };
}
