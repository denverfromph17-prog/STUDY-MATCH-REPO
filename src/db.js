import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

export function createDatabase(filename) {
  if (filename !== ':memory:') mkdirSync(path.dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      full_name TEXT NOT NULL,
      email TEXT NOT NULL COLLATE NOCASE UNIQUE,
      password_hash TEXT NOT NULL,
      date_of_birth TEXT NOT NULL,
      account_status TEXT NOT NULL DEFAULT 'active'
        CHECK (account_status IN ('active', 'suspended', 'disabled')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS profiles (
      user_id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS admin_users (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'super_admin')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
    CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
  `);
  const profileColumns = new Set(db.prepare('PRAGMA table_info(profiles)').all().map((column) => column.name));
  const additions = {
    display_name: 'TEXT', school: 'TEXT', course: 'TEXT', year_level: 'TEXT', bio: 'TEXT',
    photo_id: 'TEXT', photo_mime: 'TEXT', preferred_study_mode: 'TEXT',
  };
  for (const [name, type] of Object.entries(additions)) {
    if (!profileColumns.has(name)) db.exec(`ALTER TABLE profiles ADD COLUMN ${name} ${type}`);
  }
  db.exec('UPDATE profiles SET display_name = (SELECT full_name FROM users WHERE users.id = profiles.user_id) WHERE display_name IS NULL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS subjects (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS study_goals (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS study_styles (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS profile_subjects (
      profile_id TEXT NOT NULL, subject_id INTEGER NOT NULL,
      PRIMARY KEY (profile_id, subject_id),
      FOREIGN KEY (profile_id) REFERENCES profiles(user_id) ON DELETE CASCADE,
      FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE RESTRICT
    );
    CREATE TABLE IF NOT EXISTS profile_goals (
      profile_id TEXT NOT NULL, goal_id INTEGER NOT NULL,
      PRIMARY KEY (profile_id, goal_id),
      FOREIGN KEY (profile_id) REFERENCES profiles(user_id) ON DELETE CASCADE,
      FOREIGN KEY (goal_id) REFERENCES study_goals(id) ON DELETE RESTRICT
    );
    CREATE TABLE IF NOT EXISTS profile_study_styles (
      profile_id TEXT NOT NULL, study_style_id INTEGER NOT NULL,
      PRIMARY KEY (profile_id, study_style_id),
      FOREIGN KEY (profile_id) REFERENCES profiles(user_id) ON DELETE CASCADE,
      FOREIGN KEY (study_style_id) REFERENCES study_styles(id) ON DELETE RESTRICT
    );
    CREATE TABLE IF NOT EXISTS availability (
      id INTEGER PRIMARY KEY AUTOINCREMENT, profile_id TEXT NOT NULL,
      day_of_week TEXT NOT NULL CHECK (day_of_week IN ('Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday')),
      start_time TEXT NOT NULL, end_time TEXT NOT NULL,
      CHECK (start_time < end_time),
      UNIQUE (profile_id, day_of_week, start_time, end_time),
      FOREIGN KEY (profile_id) REFERENCES profiles(user_id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_profile_subjects_subject ON profile_subjects(subject_id);
    CREATE INDEX IF NOT EXISTS idx_profile_goals_goal ON profile_goals(goal_id);
    CREATE INDEX IF NOT EXISTS idx_profile_styles_style ON profile_study_styles(study_style_id);
    CREATE INDEX IF NOT EXISTS idx_availability_profile_day ON availability(profile_id, day_of_week);
    CREATE TABLE IF NOT EXISTS match_requests (
      id TEXT PRIMARY KEY,
      sender_user_id TEXT NOT NULL,
      receiver_user_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending','accepted','rejected','cancelled')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK (sender_user_id <> receiver_user_id),
      FOREIGN KEY (sender_user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (receiver_user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS matches (
      id TEXT PRIMARY KEY,
      user_one_id TEXT NOT NULL,
      user_two_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      CHECK (user_one_id < user_two_id),
      UNIQUE (user_one_id, user_two_id),
      FOREIGN KEY (user_one_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (user_two_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_match_requests_pending_pair
      ON match_requests(sender_user_id, receiver_user_id) WHERE status = 'pending';
    CREATE INDEX IF NOT EXISTS idx_match_requests_receiver_status ON match_requests(receiver_user_id, status);
    CREATE INDEX IF NOT EXISTS idx_match_requests_sender_status ON match_requests(sender_user_id, status);
    CREATE INDEX IF NOT EXISTS idx_matches_user_two ON matches(user_two_id);
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      user_one_id TEXT NOT NULL,
      user_two_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK (user_one_id < user_two_id),
      UNIQUE (user_one_id, user_two_id),
      FOREIGN KEY (user_one_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (user_two_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (user_one_id, user_two_id) REFERENCES matches(user_one_id, user_two_id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      sender_user_id TEXT NOT NULL,
      message_text TEXT NOT NULL CHECK (length(trim(message_text)) > 0 AND length(message_text) <= 10000),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      FOREIGN KEY (sender_user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_conversations_user_two ON conversations(user_two_id);
    CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(updated_at DESC, id);
    CREATE INDEX IF NOT EXISTS idx_messages_conversation_page ON messages(conversation_id, created_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_user_id);
    CREATE TABLE IF NOT EXISTS blocked_users (
      blocker_user_id TEXT NOT NULL, blocked_user_id TEXT NOT NULL, created_at TEXT NOT NULL,
      PRIMARY KEY (blocker_user_id, blocked_user_id), CHECK (blocker_user_id <> blocked_user_id),
      FOREIGN KEY (blocker_user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (blocked_user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY, reporter_user_id TEXT NOT NULL, reported_user_id TEXT NOT NULL,
      reason TEXT NOT NULL, description TEXT, related_conversation_id TEXT,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','reviewed','resolved')),
      created_at TEXT NOT NULL, CHECK (reporter_user_id <> reported_user_id),
      FOREIGN KEY (reporter_user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (reported_user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (related_conversation_id) REFERENCES conversations(id) ON DELETE SET NULL
    );
    CREATE TABLE IF NOT EXISTS study_sessions (
      id TEXT PRIMARY KEY, creator_user_id TEXT NOT NULL, title TEXT NOT NULL,
      description TEXT, scheduled_start TEXT NOT NULL, scheduled_end TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','cancelled','completed')),
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      CHECK (length(trim(title)) > 0 AND scheduled_start < scheduled_end),
      FOREIGN KEY (creator_user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS study_session_participants (
      session_id TEXT NOT NULL, user_id TEXT NOT NULL, created_at TEXT NOT NULL,
      PRIMARY KEY (session_id,user_id),
      FOREIGN KEY (session_id) REFERENCES study_sessions(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, type TEXT NOT NULL, title TEXT NOT NULL,
      message TEXT NOT NULL, related_entity_type TEXT, related_entity_id TEXT,
      read_at TEXT, created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_blocked_users_blocked ON blocked_users(blocked_user_id,blocker_user_id);
    CREATE INDEX IF NOT EXISTS idx_reports_status_created ON reports(status,created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_sessions_creator_start ON study_sessions(creator_user_id,scheduled_start);
    CREATE INDEX IF NOT EXISTS idx_session_participants_user ON study_session_participants(user_id,session_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_start ON study_sessions(scheduled_start);
    CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications(user_id,created_at DESC,id);
    CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(user_id,created_at DESC) WHERE read_at IS NULL;
    CREATE TRIGGER IF NOT EXISTS notify_match_request AFTER INSERT ON match_requests
    BEGIN INSERT INTO notifications(id,user_id,type,title,message,related_entity_type,related_entity_id,created_at)
      VALUES(lower(hex(randomblob(16))),NEW.receiver_user_id,'match_request','New match request','A study buddy sent you a match request.','match_request',NEW.id,NEW.created_at); END;
    CREATE TRIGGER IF NOT EXISTS notify_match_accepted AFTER UPDATE OF status ON match_requests WHEN NEW.status='accepted' AND OLD.status<>'accepted'
    BEGIN INSERT INTO notifications(id,user_id,type,title,message,related_entity_type,related_entity_id,created_at)
      VALUES(lower(hex(randomblob(16))),NEW.sender_user_id,'match_accepted','Match request accepted','Your study match request was accepted.','match_request',NEW.id,NEW.updated_at); END;
  `);
  const timestamp = new Date().toISOString();
  const seed = (table, values) => {
    const statement = db.prepare(`INSERT OR IGNORE INTO ${table} (name, created_at) VALUES (?, ?)`);
    for (const value of values) statement.run(value, timestamp);
  };
  seed('subjects', ['Mathematics','Programming','Computer Science','Database','Science','Physics','Chemistry','Biology','English','Filipino','Statistics','Accounting','Business','Engineering']);
  seed('study_goals', ['Exam Preparation','Assignment','Daily Study','Review','Group Study','Project Collaboration','Accountability']);
  seed('study_styles', ['Quiet Study','Discussion','Quiz Each Other','Problem Solving','Accountability Partner','Teaching Each Other']);
  return db;
}
