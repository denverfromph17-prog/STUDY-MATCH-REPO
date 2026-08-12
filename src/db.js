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
