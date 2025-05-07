import express  from 'express';
import mariadb  from 'mariadb';
import { v4 as uuidv4 } from 'uuid';
import axios    from 'axios';

const {
    DB_HOST, DB_USER, DB_PASS, DB_NAME,
    OLLAMA_URL = 'http://localhost:11434'
} = process.env;

const pool = mariadb.createPool({
    host: DB_HOST, user: DB_USER, password: DB_PASS,
    database: DB_NAME, connectionLimit: 8
});

const app = express();
app.use(express.json({limit:'1mb'}));

/* ---------- utilitaires ---------- */

async function query(sql, params=[]){
    const conn = await pool.getConnection();
    try{
        return await conn.query(sql, params);
    }finally{ conn.release(); }
}

/* ---------- routes REST ---------- */

app.get('/session', (_,res)=>res.json({sessionId:uuidv4()}));

app.get('/messages/:sessionId', async (req,res)=>{
    const rows = await query(
        'SELECT id,role,content FROM messages WHERE session_id=? ORDER BY id',
        [req.params.sessionId]
    );
    res.json(rows);
});

app.post('/messages/:sessionId', async (req,res)=>{
    const {role,content} = req.body;
    await query(
        'INSERT INTO messages(session_id,role,content) VALUES (?,?,?)',
        [req.params.sessionId, role, content]
    );
    res.sendStatus(204);
});

app.delete('/messages/:sessionId/:id', async (req,res)=>{
    await query(
        'DELETE FROM messages WHERE session_id=? AND id>?',[req.params.sessionId, req.params.id]
    );
    res.sendStatus(204);
});

async function makeSummary(sessionId){
    const msgs = await query(
        `SELECT id,role,content FROM messages
     WHERE session_id=? AND role IN ('user','assistant')
     ORDER BY id LIMIT 20`, [sessionId]);

    if(msgs.length<6) return;
    const prompt = `
Résume de façon concise cette portion de conversation pour garder le contexte :
${msgs.map(m=>`${m.role}: ${m.content}`).join('\n')}
  `.trim();

    const {data} = await axios.post(`${OLLAMA_URL}/api/generate`,{
        model:'mistral:7b-instruct-q4_K_M',
        prompt, temperature:0
    });

    const summary = data.response ?? data;

    const lastId = msgs[msgs.length-1].id;
    await query(
        'INSERT INTO messages(session_id,role,content) VALUES (?,?,?)',
        [sessionId,'summary',summary]
    );
    await query(
        'DELETE FROM messages WHERE session_id=? AND id<=? AND role!="summary"',
        [sessionId,lastId]
    );
}

app.post('/internal/ maybe‑summarize/:sessionId', async (req,res)=>{
    await makeSummary(req.params.sessionId);
    res.sendStatus(204);
});

const PORT = 4000;
app.listen(PORT, ()=>console.log('API running on',PORT));
