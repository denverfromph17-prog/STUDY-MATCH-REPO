import crypto from 'node:crypto';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { authMiddleware } from './auth.js';

const pair=(a,b)=>a<b?[a,b]:[b,a];
const publicParticipant=(row)=>({id:row.other_id,displayName:row.display_name,profilePictureUrl:row.photo_id?`/profile-photos/${row.photo_id}`:null,school:row.school,course:row.course,yearLevel:row.year_level});
function authorizedConversation(db,conversationId,userId){return db.prepare(`
  SELECT c.*,CASE WHEN c.user_one_id=? THEN c.user_two_id ELSE c.user_one_id END AS other_id,
    p.display_name,p.photo_id,p.school,p.course,p.year_level
  FROM conversations c
  JOIN matches m ON m.user_one_id=c.user_one_id AND m.user_two_id=c.user_two_id
  JOIN profiles p ON p.user_id=CASE WHEN c.user_one_id=? THEN c.user_two_id ELSE c.user_one_id END
  WHERE c.id=? AND (c.user_one_id=? OR c.user_two_id=? )
`).get(userId,userId,conversationId,userId,userId);}
const conversationJson=(row)=>({id:row.id,participant:publicParticipant(row),createdAt:row.created_at,updatedAt:row.updated_at});
const encodeCursor=(message)=>Buffer.from(JSON.stringify({createdAt:message.createdAt,id:message.id})).toString('base64url');
function decodeCursor(value){if(!value)return null;try{const parsed=JSON.parse(Buffer.from(value,'base64url').toString('utf8'));if(typeof parsed.createdAt!=='string'||typeof parsed.id!=='string')return null;return parsed;}catch{return null;}}

export function registerChatRoutes(app,{db,config,now}){
  const auth=authMiddleware(db);const maxLength=config.chatMaxMessageLength||2000;
  const messageSchema=z.object({message:z.string().trim().min(1).max(maxLength)}).strict();
  const sendLimit=rateLimit({windowMs:60_000,limit:config.isProduction?(config.chatMessageRateLimit||30):1000,standardHeaders:true,legacyHeaders:false,keyGenerator:(req)=>req.user.id});
  app.post('/api/conversations/open/:userId',auth,(req,res)=>{const target=req.params.userId;if(target===req.user.id)return res.status(400).json({error:'A conversation requires another matched user.'});const [one,two]=pair(req.user.id,target);if(!db.prepare('SELECT 1 FROM matches WHERE user_one_id=? AND user_two_id=?').get(one,two))return res.status(403).json({error:'Private chat is available only to matched study buddies.'});const timestamp=now().toISOString();try{db.exec('BEGIN');db.prepare('INSERT OR IGNORE INTO conversations(id,user_one_id,user_two_id,created_at,updated_at) VALUES(?,?,?,?,?)').run(crypto.randomUUID(),one,two,timestamp,timestamp);const row=db.prepare('SELECT id FROM conversations WHERE user_one_id=? AND user_two_id=?').get(one,two);db.exec('COMMIT');const conversation=authorizedConversation(db,row.id,req.user.id);res.status(200).json({conversation:conversationJson(conversation)});}catch(error){db.exec('ROLLBACK');throw error;}});
  app.get('/api/conversations',auth,(req,res)=>{const rows=db.prepare(`
    SELECT c.*,CASE WHEN c.user_one_id=? THEN c.user_two_id ELSE c.user_one_id END AS other_id,
      p.display_name,p.photo_id,p.school,p.course,p.year_level,
      (SELECT message_text FROM messages lm WHERE lm.conversation_id=c.id ORDER BY lm.created_at DESC,lm.id DESC LIMIT 1) AS last_message,
      (SELECT created_at FROM messages lm WHERE lm.conversation_id=c.id ORDER BY lm.created_at DESC,lm.id DESC LIMIT 1) AS last_message_at
    FROM conversations c JOIN matches m ON m.user_one_id=c.user_one_id AND m.user_two_id=c.user_two_id
    JOIN profiles p ON p.user_id=CASE WHEN c.user_one_id=? THEN c.user_two_id ELSE c.user_one_id END
    WHERE c.user_one_id=? OR c.user_two_id=? ORDER BY COALESCE(last_message_at,c.updated_at) DESC,c.id
  `).all(req.user.id,req.user.id,req.user.id,req.user.id);res.json({conversations:rows.map(row=>({...conversationJson(row),lastMessage:row.last_message?{message:row.last_message,createdAt:row.last_message_at}:null}))});});
  app.get('/api/conversations/:conversationId',auth,(req,res)=>{const row=authorizedConversation(db,req.params.conversationId,req.user.id);if(!row)return res.status(404).json({error:'Conversation not found.'});res.json({conversation:conversationJson(row)});});
  app.get('/api/conversations/:conversationId/messages',auth,(req,res)=>{const conversation=authorizedConversation(db,req.params.conversationId,req.user.id);if(!conversation)return res.status(404).json({error:'Conversation not found.'});const requested=Number(req.query.limit);const limit=Number.isInteger(requested)&&requested>0?Math.min(requested,config.chatMaxPageSize||100):config.chatDefaultPageSize||50;const cursor=req.query.cursor?decodeCursor(req.query.cursor):null;if(req.query.cursor&&!cursor)return res.status(400).json({error:'Invalid pagination cursor.'});const rows=cursor?db.prepare(`SELECT id,sender_user_id AS senderUserId,message_text AS message,created_at AS createdAt,updated_at AS updatedAt FROM messages WHERE conversation_id=? AND (created_at<? OR (created_at=? AND id<?)) ORDER BY created_at DESC,id DESC LIMIT ?`).all(conversation.id,cursor.createdAt,cursor.createdAt,cursor.id,limit+1):db.prepare(`SELECT id,sender_user_id AS senderUserId,message_text AS message,created_at AS createdAt,updated_at AS updatedAt FROM messages WHERE conversation_id=? ORDER BY created_at DESC,id DESC LIMIT ?`).all(conversation.id,limit+1);const hasMore=rows.length>limit;const messages=rows.slice(0,limit);res.json({messages,pagination:{limit,hasMore,nextCursor:hasMore?encodeCursor(messages[messages.length-1]):null}});});
  app.post('/api/conversations/:conversationId/messages',auth,sendLimit,(req,res)=>{const conversation=authorizedConversation(db,req.params.conversationId,req.user.id);if(!conversation)return res.status(404).json({error:'Conversation not found.'});const parsed=messageSchema.safeParse(req.body);if(!parsed.success)return res.status(400).json({error:`Message must contain 1 to ${maxLength} characters.`});const timestamp=now().toISOString(),id=crypto.randomUUID();try{db.exec('BEGIN');db.prepare('INSERT INTO messages(id,conversation_id,sender_user_id,message_text,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(id,conversation.id,req.user.id,parsed.data.message,timestamp,timestamp);db.prepare('UPDATE conversations SET updated_at=? WHERE id=?').run(timestamp,conversation.id);db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}res.status(201).json({message:{id,senderUserId:req.user.id,message:parsed.data.message,createdAt:timestamp,updatedAt:timestamp}});});
}
