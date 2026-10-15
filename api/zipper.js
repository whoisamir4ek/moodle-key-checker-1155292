import Busboy from 'busboy';
import { gzip } from 'node:zlib';

export const config = { api: { bodyParser: false } };
const MAX_FILE_SIZE = 10 * 1024 * 1024;

function readUploadedFile(req) {
  return new Promise((resolve, reject) => {
    let parser;
    let fileFound = false;
    let tooLarge = false;
    const chunks = [];
    const fail = (error) => reject(error);

    try {
      parser = Busboy({ headers: req.headers, limits: { files: 1, fileSize: MAX_FILE_SIZE } });
    } catch (error) {
      reject(error);
      return;
    }

    parser.on('file', (fieldName, stream) => {
      if (fieldName !== 'file' || fileFound) {
        stream.resume();
        return;
      }
      fileFound = true;
      stream.on('data', (chunk) => chunks.push(chunk));
      stream.on('limit', () => { tooLarge = true; });
      stream.on('error', fail);
    });
    parser.on('error', fail);
    parser.on('finish', () => {
      if (tooLarge) {
        const error = new Error('Uploaded file is too large');
        error.statusCode = 413;
        reject(error);
      } else {
        resolve(fileFound ? Buffer.concat(chunks) : null);
      }
    });
    req.on('error', fail);
    req.pipe(parser);
  });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Accept');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).end('Use POST with multipart/form-data');

  try {
    const input = await readUploadedFile(req);
    if (!input) return res.status(400).end('Expected a file field named file');
    const compressed = await new Promise((resolve, reject) => {
      gzip(input, (error, result) => error ? reject(error) : resolve(result));
    });
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', 'attachment; filename="result.gz"');
    res.setHeader('Content-Length', compressed.length);
    return res.status(200).send(compressed);
  } catch (error) {
    return res.status(error.statusCode || 400).end('Unable to process uploaded file');
  }
}
