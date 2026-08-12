import crypto from 'node:crypto';
import path from 'node:path';
import { mkdirSync, unlinkSync } from 'node:fs';
import multer from 'multer';
import { z } from 'zod';
import { authMiddleware } from './auth.js';

const YEAR_LEVELS = ['1st Year','2nd Year','3rd Year','4th Year','Graduate','Other'];
const DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
const optionalText = (max) => z.string().trim().max(max).nullable();
const ids = z.array(z.number().int().positive()).max(50).refine((list) => new Set(list).size === list.length, 'Duplicate IDs are not allowed.');
const profileSchema = z.object({
  displayName: z.string().trim().min(1).max(80), school: optionalText(120), course: optionalText(120),
  yearLevel: z.enum(YEAR_LEVELS).nullable(), bio: optionalText(500),
  preferredStudyMode: z.enum(['Online','In-person','Either']).nullable(),
  subjectIds: ids, goalIds: ids, studyStyleIds: ids,
}).strict();
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const availabilitySchema = z.array(z.object({ day: z.enum(DAYS), startTime: time, endTime: time }).strict()
  .refine((entry) => entry.startTime < entry.endTime, { message:'Start time must be before end time.' })).max(50);

const listSelected = (db, table, junction, foreignKey, userId) => db.prepare(`
  SELECT c.id, c.name FROM ${table} c JOIN ${junction} j ON j.${foreignKey} = c.id
  WHERE j.profile_id = ? ORDER BY c.name
`).all(userId);

export function getProfile(db, userId) {
  const row = db.prepare('SELECT display_name, school, course, year_level, bio, photo_id, preferred_study_mode, created_at, updated_at FROM profiles WHERE user_id = ?').get(userId);
  return {
    displayName: row.display_name, school: row.school, course: row.course, yearLevel: row.year_level, bio: row.bio,
    profilePictureUrl: row.photo_id ? `/profile-photos/${row.photo_id}` : null,
    preferredStudyMode: row.preferred_study_mode,
    subjects: listSelected(db, 'subjects', 'profile_subjects', 'subject_id', userId),
    studyGoals: listSelected(db, 'study_goals', 'profile_goals', 'goal_id', userId),
    studyStyles: listSelected(db, 'study_styles', 'profile_study_styles', 'study_style_id', userId),
    availability: db.prepare('SELECT day_of_week AS day, start_time AS startTime, end_time AS endTime FROM availability WHERE profile_id = ? ORDER BY CASE day_of_week WHEN \'Monday\' THEN 1 WHEN \'Tuesday\' THEN 2 WHEN \'Wednesday\' THEN 3 WHEN \'Thursday\' THEN 4 WHEN \'Friday\' THEN 5 WHEN \'Saturday\' THEN 6 ELSE 7 END, start_time').all(userId),
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function ensureIds(db, table, values) {
  if (!values.length) return true;
  const placeholders = values.map(() => '?').join(',');
  return db.prepare(`SELECT count(*) count FROM ${table} WHERE id IN (${placeholders})`).get(...values).count === values.length;
}

function replaceLinks(db, junction, column, userId, values) {
  db.prepare(`DELETE FROM ${junction} WHERE profile_id = ?`).run(userId);
  const insert = db.prepare(`INSERT INTO ${junction} (profile_id, ${column}) VALUES (?, ?)`);
  for (const value of values) insert.run(userId, value);
}

export function registerProfileRoutes(app, { db, config, now }) {
  const authenticate = authMiddleware(db);
  const uploadDir = config.uploadDir || path.resolve('data/uploads/profile-photos');
  mkdirSync(uploadDir, { recursive:true });
  const upload = multer({ storage:multer.memoryStorage(), limits:{ fileSize:5 * 1024 * 1024, files:1 } });
  app.use('/profile-photos', expressStaticSafe(uploadDir));
  app.get('/api/profile', authenticate, (req, res) => res.json({ profile:getProfile(db, req.user.id) }));
  app.put('/api/profile', authenticate, (req, res) => {
    const parsed = profileSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error:'Invalid profile details.', details:parsed.error.flatten() });
    const p = parsed.data;
    if (!ensureIds(db,'subjects',p.subjectIds) || !ensureIds(db,'study_goals',p.goalIds) || !ensureIds(db,'study_styles',p.studyStyleIds)) return res.status(400).json({ error:'One or more selected options do not exist.' });
    try {
      db.exec('BEGIN');
      db.prepare('UPDATE profiles SET display_name=?, school=?, course=?, year_level=?, bio=?, preferred_study_mode=?, updated_at=? WHERE user_id=?')
        .run(p.displayName,p.school,p.course,p.yearLevel,p.bio,p.preferredStudyMode,now().toISOString(),req.user.id);
      replaceLinks(db,'profile_subjects','subject_id',req.user.id,p.subjectIds);
      replaceLinks(db,'profile_goals','goal_id',req.user.id,p.goalIds);
      replaceLinks(db,'profile_study_styles','study_style_id',req.user.id,p.studyStyleIds);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    res.json({ profile:getProfile(db,req.user.id) });
  });
  app.get('/api/subjects', (_req,res) => res.json({ subjects:db.prepare('SELECT id,name FROM subjects ORDER BY name').all() }));
  app.get('/api/study-goals', (_req,res) => res.json({ studyGoals:db.prepare('SELECT id,name FROM study_goals ORDER BY name').all() }));
  app.get('/api/study-styles', (_req,res) => res.json({ studyStyles:db.prepare('SELECT id,name FROM study_styles ORDER BY name').all() }));
  app.get('/api/profile/availability', authenticate, (req,res) => res.json({ availability:getProfile(db,req.user.id).availability }));
  app.put('/api/profile/availability', authenticate, (req,res) => {
    const parsed=availabilitySchema.safeParse(req.body.availability);
    if(!parsed.success) return res.status(400).json({error:'Invalid availability.',details:parsed.error.flatten()});
    try { db.exec('BEGIN'); db.prepare('DELETE FROM availability WHERE profile_id=?').run(req.user.id); const add=db.prepare('INSERT INTO availability(profile_id,day_of_week,start_time,end_time) VALUES(?,?,?,?)'); for(const a of parsed.data)add.run(req.user.id,a.day,a.startTime,a.endTime); db.prepare('UPDATE profiles SET updated_at=? WHERE user_id=?').run(now().toISOString(),req.user.id); db.exec('COMMIT'); } catch(error){db.exec('ROLLBACK'); if(String(error).includes('UNIQUE')) return res.status(400).json({error:'Duplicate availability entry.'}); throw error;}
    res.json({availability:getProfile(db,req.user.id).availability});
  });
  app.post('/api/profile/photo', authenticate, (req,res,next) => upload.single('photo')(req,res,(error) => {
    if(error) return res.status(error.code==='LIMIT_FILE_SIZE'?413:400).json({error:error.code==='LIMIT_FILE_SIZE'?'Profile picture must be 5 MB or smaller.':'Invalid upload.'});
    if(!req.file) return res.status(400).json({error:'A profile picture is required.'});
    const signatures={ 'image/jpeg':[[0xff,0xd8,0xff]], 'image/png':[[0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]], 'image/webp':[[0x52,0x49,0x46,0x46]] };
    const signature=signatures[req.file.mimetype]; const valid=signature?.some((sig)=>sig.every((byte,index)=>req.file.buffer[index]===byte)) && (req.file.mimetype!=='image/webp'||req.file.buffer.subarray(8,12).toString()==='WEBP');
    if(!valid) return res.status(400).json({error:'Only valid JPEG, PNG, or WebP images are allowed.'});
    const ext={'image/jpeg':'.jpg','image/png':'.png','image/webp':'.webp'}[req.file.mimetype]; const photoId=`${crypto.randomUUID()}${ext}`;
    const old=db.prepare('SELECT photo_id FROM profiles WHERE user_id=?').get(req.user.id).photo_id;
    import('node:fs').then(({writeFileSync})=>{ writeFileSync(path.join(uploadDir,photoId),req.file.buffer,{flag:'wx'}); db.prepare('UPDATE profiles SET photo_id=?,photo_mime=?,updated_at=? WHERE user_id=?').run(photoId,req.file.mimetype,now().toISOString(),req.user.id); if(old) safeDelete(uploadDir,old); res.json({profilePictureUrl:`/profile-photos/${photoId}`}); }).catch(next);
  }));
  app.delete('/api/profile/photo', authenticate, (req,res) => { const old=db.prepare('SELECT photo_id FROM profiles WHERE user_id=?').get(req.user.id).photo_id; db.prepare('UPDATE profiles SET photo_id=NULL,photo_mime=NULL,updated_at=? WHERE user_id=?').run(now().toISOString(),req.user.id); if(old)safeDelete(uploadDir,old); res.status(204).end(); });
}

function safeDelete(directory, filename) { try { unlinkSync(path.join(directory,path.basename(filename))); } catch(error) { if(error.code!=='ENOENT') throw error; } }
function expressStaticSafe(directory) { return (req,res,next) => { const name=path.basename(req.path); if(name!==req.path.slice(1)) return res.status(404).end(); res.sendFile(name,{root:directory,dotfiles:'deny'},(error)=>{if(error&&!res.headersSent)next();}); }; }
