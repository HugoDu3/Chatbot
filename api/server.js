import express  from 'express';
import mariadb  from 'mariadb';
import { v4 as uuidv4 } from 'uuid';
import axios    from 'axios';

const {
    DB_HOST,
    DB_USER,
    DB_PASS,
    DB_NAME,
    OLLAMA_URL = 'http://localhost:11434'
} = process.env;

const pool = mariadb.createPool({
    host: DB_HOST,
    user: DB_USER,
    password: DB_PASS,
    database: DB_NAME,
    connectionLimit: 8
});
async function query(sql, params=[]){
    const conn = await pool.getConnection();
    try{ return await conn.query(sql, params); }
    finally{ conn.release(); }
}

(async function initDb(){
    let conn;
    try{
        conn = await pool.getConnection();
        console.log('✔️  MariaDB connecté');
        await conn.query(`
      CREATE TABLE IF NOT EXISTS messages(
        id         BIGINT AUTO_INCREMENT PRIMARY KEY,
        session_id CHAR(36)                                NOT NULL,
        role       ENUM('user','assistant','summary')      NOT NULL,
        content    TEXT                                    NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
        console.log('✔️  Table "messages" OK');
    }catch(err){
        console.error('❌  InitDB :',err);
        process.exit(1);
    }finally{ conn?.release(); }
})();

const app = express();
app.use(express.json({limit:'1mb'}));

app.get('/session',(_,res)=> res.json({sessionId:uuidv4()}));

app.get('/messages/:sessionId', async (req,res)=>{
    const rows = await query(
        `SELECT id,role,content
       FROM messages
      WHERE session_id=? AND role IN ('user','assistant')
      ORDER BY id`,
        [req.params.sessionId]
    );
    res.json(rows.map(r=>({
        id:      r.id.toString(),
        role:    r.role,
        content: r.content
    })));
});

app.post('/messages/:sessionId', async (req,res)=>{
    const { role,content } = req.body;
    const r = await query(
        'INSERT INTO messages(session_id,role,content) VALUES (?,?,?)',
        [req.params.sessionId, role, content]
    );
    const insertId = typeof r.insertId==='bigint'
        ? r.insertId.toString()
        : r.insertId;
    res.json({insertId});
});

app.delete('/messages/:sessionId/:id', async (req,res)=>{
    await query(
        'DELETE FROM messages WHERE session_id=? AND id>=?',
        [req.params.sessionId, req.params.id]
    );
    res.sendStatus(204);
});

async function makeSummary(sessionId){
    const msgs = await query(
        `SELECT id,role,content
       FROM messages
      WHERE session_id=? AND role IN ('user','assistant')
      ORDER BY id DESC LIMIT 20`,
        [sessionId]
    );
    if(msgs.length < 6) return;

    const prompt = `
Résume de façon concise cette portion de conversation pour garder le contexte:
${msgs.reverse().map(m=>`${m.role}: ${m.content}`).join('\n')}
  `.trim();

    const { data } = await axios.post(`${OLLAMA_URL}/api/generate`,{
        model:'mistral:7b-instruct-q4_K_M',
        prompt,
        temperature:0,
        stream:false
    });

    const summaryText = typeof data?.response === 'string'
        ? data.response
        : String(data);

    await query(
        'INSERT INTO messages(session_id,role,content) VALUES (?,?,?)',
        [sessionId,'summary',summaryText]
    );

}
app.post('/internal/maybe-summarize/:sessionId', async (req,res)=>{
    await makeSummary(req.params.sessionId);
    res.sendStatus(204);
});

const PORT = 4000;
app.listen(PORT,()=> console.log(`API sur http://localhost:${PORT}`));
