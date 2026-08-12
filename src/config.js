import path from 'node:path';

const integer = (name, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  return value;
};

const trustProxy = () => {
  const value = process.env.TRUST_PROXY;
  if (!value || value === 'false') return false;
  if (value === 'true') return 1;
  const hops = Number(value);
  if (!Number.isInteger(hops) || hops < 1 || hops > 10) throw new Error('TRUST_PROXY must be false, true, or a hop count from 1 to 10.');
  return hops;
};

export function getConfig(overrides = {}) {
  const config = {
    port: integer('PORT', 3000, { max:65535 }),
    databasePath: process.env.DATABASE_PATH || path.resolve('data/study-match.db'),
    uploadDir: process.env.UPLOAD_DIR || path.resolve('data/uploads/profile-photos'),
    isProduction: process.env.NODE_ENV === 'production',
    trustProxy: trustProxy(),
    sessionDays: 7,
    matchMinimumScore: integer('MATCH_MINIMUM_SCORE', 40, { min:0, max:100 }),
    matchLimit: integer('MATCH_LIMIT', 20, { max:100 }),
    matchCandidateScanLimit: integer('MATCH_CANDIDATE_SCAN_LIMIT', 500, { max:5000 }),
    chatMaxMessageLength: integer('CHAT_MAX_MESSAGE_LENGTH', 2000, { max:10000 }),
    chatDefaultPageSize: integer('CHAT_DEFAULT_PAGE_SIZE', 50, { max:100 }),
    chatMaxPageSize: integer('CHAT_MAX_PAGE_SIZE', 100, { max:100 }),
    chatMessageRateLimit: integer('CHAT_MESSAGE_RATE_LIMIT', 30, { max:300 }),
    ...overrides,
  };
  if (config.chatDefaultPageSize > config.chatMaxPageSize) throw new Error('CHAT_DEFAULT_PAGE_SIZE cannot exceed CHAT_MAX_PAGE_SIZE.');
  if (config.matchLimit > config.matchCandidateScanLimit) throw new Error('MATCH_LIMIT cannot exceed MATCH_CANDIDATE_SCAN_LIMIT.');
  return config;
}
