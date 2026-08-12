const WEIGHTS = { subjects:35, goals:20, styles:15, mode:10, availability:20 };

const shared = (a,b) => { const set=new Set(a.map(x=>x.id)); return b.filter(x=>set.has(x.id)); };
const setScore = (a,b,weight) => {
  if(!a.length||!b.length) return 0;
  return weight * shared(a,b).length / Math.max(a.length,b.length);
};
const minutes = (time) => { const [h,m]=time.split(':').map(Number); return h*60+m; };
const scheduleTotal = (entries) => entries.reduce((sum,x)=>sum+minutes(x.endTime)-minutes(x.startTime),0);
function overlapSchedules(a,b) {
  let overlapMinutes=0, overlapCount=0; const overlaps=[];
  for(const left of a) for(const right of b) if(left.day===right.day) {
    const start=Math.max(minutes(left.startTime),minutes(right.startTime));
    const end=Math.min(minutes(left.endTime),minutes(right.endTime));
    if(start<end){overlapMinutes+=end-start;overlapCount++;overlaps.push({day:left.day,startTime:`${String(Math.floor(start/60)).padStart(2,'0')}:${String(start%60).padStart(2,'0')}`,endTime:`${String(Math.floor(end/60)).padStart(2,'0')}:${String(end%60).padStart(2,'0')}`});}
  }
  return { overlapMinutes, overlapCount, overlaps };
}

export function calculateCompatibility(viewer,candidate) {
  const sharedSubjects=shared(viewer.subjects,candidate.subjects), sharedGoals=shared(viewer.studyGoals,candidate.studyGoals), sharedStyles=shared(viewer.studyStyles,candidate.studyStyles);
  const subjectScore=setScore(viewer.subjects,candidate.subjects,WEIGHTS.subjects), goalScore=setScore(viewer.studyGoals,candidate.studyGoals,WEIGHTS.goals), styleScore=setScore(viewer.studyStyles,candidate.studyStyles,WEIGHTS.styles);
  let modeScore=0, modeReason=null;
  if(viewer.preferredStudyMode&&candidate.preferredStudyMode){if(viewer.preferredStudyMode===candidate.preferredStudyMode){modeScore=10;modeReason='Same study mode';}else if(viewer.preferredStudyMode==='Either'||candidate.preferredStudyMode==='Either'){modeScore=5;modeReason='Flexible study mode';}}
  const schedule=overlapSchedules(viewer.availability,candidate.availability); const denominator=Math.max(scheduleTotal(viewer.availability),scheduleTotal(candidate.availability)); const availabilityScore=denominator?WEIGHTS.availability*schedule.overlapMinutes/denominator:0;
  const reasons=[];
  if(sharedSubjects.length)reasons.push(`${sharedSubjects.length} shared subject${sharedSubjects.length===1?'':'s'}`);
  if(sharedGoals.length)reasons.push(`${sharedGoals.length} shared study goal${sharedGoals.length===1?'':'s'}`);
  if(sharedStyles.length)reasons.push(`${sharedStyles.length} shared study style${sharedStyles.length===1?'':'s'}`);
  if(modeReason)reasons.push(modeReason);
  if(schedule.overlapCount)reasons.push(`${schedule.overlapCount} overlapping study schedule${schedule.overlapCount===1?'':'s'}`);
  return { score:Math.max(0,Math.min(100,Math.round(subjectScore+goalScore+styleScore+modeScore+availabilityScore))), reasons, breakdown:{subjects:Math.round(subjectScore),goals:Math.round(goalScore),studyStyles:Math.round(styleScore),studyMode:modeScore,availability:Math.round(availabilityScore)}, shared:{subjects:sharedSubjects,studyGoals:sharedGoals,studyStyles:sharedStyles,availability:schedule.overlaps} };
}

const collect = (db,sql,ids) => { const map=new Map(ids.map(id=>[id,[]])); if(!ids.length)return map; const marks=ids.map(()=>'?').join(','); for(const row of db.prepare(sql.replace('?',marks)).all(...ids))map.get(row.userId).push(row); return map; };
export function loadMatchProfiles(db,userIds) {
  if(!userIds.length)return new Map(); const marks=userIds.map(()=>'?').join(',');
  const rows=db.prepare(`SELECT p.user_id AS userId,p.display_name AS displayName,p.school,p.course,p.year_level AS yearLevel,p.bio,p.photo_id AS photoId,p.preferred_study_mode AS preferredStudyMode FROM profiles p WHERE p.user_id IN (${marks})`).all(...userIds);
  const subjects=collect(db,'SELECT j.profile_id AS userId,c.id,c.name FROM profile_subjects j JOIN subjects c ON c.id=j.subject_id WHERE j.profile_id IN (?)',userIds);
  const goals=collect(db,'SELECT j.profile_id AS userId,c.id,c.name FROM profile_goals j JOIN study_goals c ON c.id=j.goal_id WHERE j.profile_id IN (?)',userIds);
  const styles=collect(db,'SELECT j.profile_id AS userId,c.id,c.name FROM profile_study_styles j JOIN study_styles c ON c.id=j.study_style_id WHERE j.profile_id IN (?)',userIds);
  const availability=collect(db,'SELECT profile_id AS userId,day_of_week AS day,start_time AS startTime,end_time AS endTime FROM availability WHERE profile_id IN (?)',userIds);
  return new Map(rows.map(row=>[row.userId,{...row,profilePictureUrl:row.photoId?`/profile-photos/${row.photoId}`:null,subjects:subjects.get(row.userId),studyGoals:goals.get(row.userId),studyStyles:styles.get(row.userId),availability:availability.get(row.userId)}]));
}

export function discoverMatches(db,userId,config) {
  const scanLimit=Math.max(config.matchLimit,config.matchCandidateScanLimit||500);
  const candidates=db.prepare(`SELECT p.user_id FROM profiles p JOIN users u ON u.id=p.user_id WHERE p.user_id<>? AND u.account_status='active' AND (EXISTS(SELECT 1 FROM profile_subjects x WHERE x.profile_id=p.user_id) OR EXISTS(SELECT 1 FROM profile_goals x WHERE x.profile_id=p.user_id) OR EXISTS(SELECT 1 FROM profile_study_styles x WHERE x.profile_id=p.user_id)) ORDER BY p.user_id LIMIT ?`).all(userId,scanLimit).map(x=>x.user_id);
  const profiles=loadMatchProfiles(db,[userId,...candidates]); const viewer=profiles.get(userId); if(!viewer)return [];
  return candidates.map(id=>{const p=profiles.get(id);const compatibility=calculateCompatibility(viewer,p);return {user:{id,displayName:p.displayName,profilePictureUrl:p.profilePictureUrl,school:p.school,course:p.course,yearLevel:p.yearLevel,bio:p.bio,subjects:p.subjects,studyGoals:p.studyGoals,studyStyles:p.studyStyles,preferredStudyMode:p.preferredStudyMode,availability:p.availability},compatibility};}).filter(x=>x.compatibility.score>=config.matchMinimumScore).sort((a,b)=>b.compatibility.score-a.compatibility.score||a.user.id.localeCompare(b.user.id)).slice(0,config.matchLimit);
}
