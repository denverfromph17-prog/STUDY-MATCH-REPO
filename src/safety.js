export const pair=(a,b)=>a<b?[a,b]:[b,a];
export function isBlocked(db,a,b){return !!db.prepare('SELECT 1 FROM blocked_users WHERE (blocker_user_id=? AND blocked_user_id=?) OR (blocker_user_id=? AND blocked_user_id=?)').get(a,b,b,a);}
export function areMatched(db,a,b){const[one,two]=pair(a,b);return !!db.prepare('SELECT 1 FROM matches WHERE user_one_id=? AND user_two_id=?').get(one,two);}
export function canInteract(db,a,b){return a!==b&&!isBlocked(db,a,b);}
