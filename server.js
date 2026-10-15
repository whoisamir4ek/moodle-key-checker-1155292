import http from 'node:http';
import { deflateSync, gzip } from 'node:zlib';
import Busboy from 'busboy';

const PORT = Number(process.env.PORT || 3000);
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Accept',
};
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = crcTable[(c ^ byte) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  const length = Buffer.alloc(4);
  const checksum = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, checksum]);
}
function makePng(width, height) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const row = Buffer.alloc(1 + width * 4);
  row.fill(255, 1);
  const pixels = Buffer.alloc(row.length * height);
  for (let y = 0; y < height; y++) row.copy(pixels, y * row.length);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(pixels)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}
function readUpload(req) {
  return new Promise((resolve, reject) => {
    let found = false;
    let tooLarge = false;
    const chunks = [];
    let parser;
    try {
      parser = Busboy({ headers: req.headers, limits: { files: 1, fileSize: 10485760 } });
    } catch (error) { reject(error); return; }
    parser.on('file', (field, stream) => {
      if (field !== 'file' || found) { stream.resume(); return; }
      found = true;
      stream.on('data', chunk => chunks.push(chunk));
      stream.on('limit', () => { tooLarge = true; });
      stream.on('error', reject);
    });
    parser.on('error', reject);
    parser.on('finish', () => {
      if (tooLarge) return reject(new Error('File too large'));
      resolve(found ? Buffer.concat(chunks) : null);
    });
    req.on('error', reject);
    req.pipe(parser);
  });
}
function sendText(res, status, text) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=UTF-8' });
  res.end(text);
}

const server = http.createServer(async (req, res) => {
  for (const [key, value] of Object.entries(cors)) res.setHeader(key, value);
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname;
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  if (path === '/' || path === '/login' || path === '/login/') return sendText(res, 200, '1155292');
  if (path === '/makeimage' || path === '/makeimage/') {
    const width = Number(url.searchParams.get('width'));
    const height = Number(url.searchParams.get('height'));
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width > 10000 || height > 10000 || width * height > 25000000) return sendText(res, 400, 'Invalid image dimensions');
    res.writeHead(200, { 'Content-Type': 'image/png' });
    return res.end(makePng(width, height));
  }
  if (path === '/zipper' || path === '/zipper/') {
    if (req.method !== 'POST') return sendText(res, 405, 'Use POST with multipart/form-data');
    try {
      const input = await readUpload(req);
      if (!input) return sendText(res, 400, 'Expected a file field named file');
      const output = await new Promise((resolve, reject) => gzip(input, (error, result) => error ? reject(error) : resolve(result)));
      res.writeHead(200, { 'Content-Type': 'application/gzip', 'Content-Disposition': 'attachment; filename="result.gz"', 'Content-Length': output.length });
      return res.end(output);
    } catch (error) {
      return sendText(res, error.message === 'File too large' ? 413 : 400, 'Unable to process uploaded file');
    }
  }
  return sendText(res, 404, 'Not found');
});
server.listen(PORT, '0.0.0.0');
