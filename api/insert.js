import mongodb from 'mongodb';
const { MongoClient } = mongodb;
function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Accept');
}
function readFormBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : req.body;
  if (typeof raw === 'string') return Object.fromEntries(new URLSearchParams(raw));
  return {};
}
function parseConnectionString(value) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const parsed = new URL(value);
    const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
    if (!['mongodb:', 'mongodb+srv:'].includes(parsed.protocol) || parsed.hostname !== 'kodaktor.ru' || database !== 'readusers') return null;
    return value;
  } catch {
    return null;
  }
}
export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST with application/x-www-form-urlencoded' });
  const body = readFormBody(req);
  const login = body.login;
  const password = body.password;
  const connectionString = parseConnectionString(body.URL ?? body.url);
  if (typeof login !== 'string' || login.length === 0 || login.length > 200 || typeof password !== 'string' || password.length === 0 || password.length > 2000 || !connectionString) return res.status(400).json({ error: 'Invalid login, password, or database URL' });
  const client = new MongoClient(connectionString, { connectTimeoutMS: 10000, serverSelectionTimeoutMS: 10000 });
  try {
    await client.connect();
    await client.db('readusers').collection('users').insertOne({ login, password });
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('MongoDB insert failed:', error.message);
    return res.status(500).json({ error: 'Database insert failed' });
  } finally {
    await client.close().catch(() => {});
  }
}
