const http = require('http');
const fs = require('fs');
const path = require('path');
const Busboy = require('busboy');
const { PDFParse } = require('pdf-parse');

const root = __dirname;
const types = { '.css': 'text/css', '.js': 'application/javascript', '.html': 'text/html', '.json': 'application/json' };
const knownSkills = ['accounting', 'finance', 'accounts receivable', 'ifrs', 'excel', 'erp', 'revenue recognition', 'reconciliation', 'collections', 'audit', 'treasury', 'figma', 'product design', 'ux design', 'ui design', 'design systems', 'saas', 'b2b', 'user research', 'react', 'javascript', 'typescript', 'node.js', 'python', 'java', 'sql', 'aws', 'salesforce', 'hubspot', 'data analysis', 'machine learning', 'project management'];
const uploadAttempts = new Map();

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}
function allowUpload(req) {
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').toString().split(',')[0].trim();
  const now = Date.now();
  const recent = (uploadAttempts.get(ip) || []).filter(time => now - time < 10 * 60 * 1000);
  if (recent.length >= 8) return false;
  recent.push(now); uploadAttempts.set(ip, recent);
  return true;
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 200000) reject(new Error('Request is too large.'));
    });
    req.on('end', () => { try { resolve(JSON.parse(body)); } catch { reject(new Error('Invalid request.')); } });
    req.on('error', reject);
  });
}
function readMultipart(req) {
  return new Promise((resolve, reject) => {
    const fields = {}; const files = []; let failed = false;
    const parser = Busboy({ headers: req.headers, limits: { files: 20, fileSize: 10 * 1024 * 1024 } });
    parser.on('field', (name, value) => { fields[name] = value; });
    parser.on('file', (name, file, info) => {
      if (name !== 'cvs' || (!info.mimeType.includes('pdf') && !info.filename.toLowerCase().endsWith('.pdf'))) { file.resume(); return; }
      const chunks = []; let size = 0; let tooLarge = false;
      file.on('data', chunk => { size += chunk.length; if (size <= 10 * 1024 * 1024) chunks.push(chunk); });
      file.on('limit', () => { tooLarge = true; });
      file.on('end', () => { if (tooLarge) failed = true; else files.push({ filename: info.filename, data: Buffer.concat(chunks) }); });
    });
    parser.on('filesLimit', () => { failed = true; });
    parser.on('error', reject);
    parser.on('finish', () => { if (failed) reject(new Error('Use up to 20 PDF files, each no larger than 10 MB.')); else resolve({ fields, files }); });
    req.pipe(parser);
  });
}
function decode(value = '') {
  return value.replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16))).replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number.parseInt(code, 10))).replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
}
function decodePdfText(value = '') {
  return value.replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16))).replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number.parseInt(code, 10))).replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}
function meta(html, property) {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${escaped}["']`, 'i')
  ];
  for (const pattern of patterns) { const match = html.match(pattern); if (match) return decode(match[1]); }
  return '';
}
function extractCriteria(jobDescription) {
  jobDescription = decode(jobDescription);
  const lower = jobDescription.toLowerCase();
  const skills = knownSkills.filter(skill => lower.includes(skill)).slice(0, 6);
  const title = jobDescription.split(/\r?\n/).map(line => line.trim()).find(line => line.length >= 3 && line.length <= 70 && !/^(about us|responsibilities|qualifications|benefits)$/i.test(line)) || '';
  return { titles: title ? [title] : [], location: [], experience: [], required: skills, preferred: [] };
}
function normalizeCriteria(input, jobDescription) {
  const fallback = extractCriteria(jobDescription);
  if (!input || typeof input !== 'object') return fallback;
  const values = key => Array.isArray(input[key]) ? input[key].filter(value => typeof value === 'string' && value.length <= 100).slice(0, 12) : fallback[key];
  return { titles: values('titles'), location: values('location'), experience: values('experience'), required: values('required'), preferred: values('preferred') };
}
function scoreProfile(profileText, criteria) {
  const text = profileText.toLowerCase();
  const matchingTitle = criteria.titles.find(title => text.includes(title.toLowerCase()));
  const matchedRequired = criteria.required.filter(skill => text.includes(skill.toLowerCase()));
  const matchedPreferred = criteria.preferred.filter(skill => text.includes(skill.toLowerCase()));
  const matchedLocation = criteria.location.find(location => text.includes(location.toLowerCase()) || location.toLowerCase().split(',')[0] && text.includes(location.toLowerCase().split(',')[0]));
  const matchedExperience = criteria.experience.find(experience => text.includes(experience.toLowerCase()));
  const titleScore = criteria.titles.length && matchingTitle ? 40 : 0;
  const requiredScore = criteria.required.length ? Math.round((matchedRequired.length / criteria.required.length) * 35) : 0;
  const preferredScore = criteria.preferred.length ? Math.round((matchedPreferred.length / criteria.preferred.length) * 10) : 0;
  const locationScore = criteria.location.length && matchedLocation ? 10 : 0;
  const experienceScore = criteria.experience.length && matchedExperience ? 5 : 0;
  const score = Math.min(100, titleScore + requiredScore + preferredScore + locationScore + experienceScore);
  const reasons = [];
  const gaps = [];
  if (matchingTitle) reasons.push(`Title: ${matchingTitle}`); else if (criteria.titles.length) gaps.push('Job title');
  if (matchedRequired.length) reasons.push(`Required skills: ${matchedRequired.join(', ')}`);
  criteria.required.filter(skill => !matchedRequired.includes(skill)).forEach(skill => gaps.push(skill));
  if (matchedPreferred.length) reasons.push(`Preferred skills: ${matchedPreferred.join(', ')}`);
  if (matchedLocation) reasons.push(`Location: ${matchedLocation}`); else if (criteria.location.length) gaps.push(criteria.location[0]);
  if (matchedExperience) reasons.push(`Experience: ${matchedExperience}`); else if (criteria.experience.length) gaps.push(criteria.experience[0]);
  if (!reasons.length) reasons.push('No selected criteria found in public metadata');
  return { score, reasons, gaps: gaps.slice(0, 6) };
}
function candidateName(text, filename) {
  const ignored = /^(contact|summary|experience|education|top skills|languages|page \d|الاتصال|موجز|الخبرة|التعليم|أفضل المهارات)$/i;
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(line => line && !ignored.test(line) && !/^https?:|^www\./i.test(line));
  const role = /accountant|consultant|designer|developer|engineer|manager|specialist|analyst|director|coordinator|lead|officer|representative/i;
  const latin = lines.find((line, index) => /^[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3}$/.test(line) && role.test(lines[index + 1] || ''));
  if (latin) return latin;
  const arabic = lines.find(line => /^[\u0621-\u064A]{2,}(?:\s+[\u0621-\u064A]{2,}){1,3}$/.test(line));
  return arabic || path.basename(filename, path.extname(filename));
}
function cvSection(text, starts, ends, maxLength = 340) {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const start = lines.findIndex(line => starts.some(pattern => pattern.test(line)));
  if (start === -1) return '';
  const collected = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    if (ends.some(pattern => pattern.test(lines[index]))) break;
    collected.push(lines[index]);
  }
  return collected.join(' ').replace(/\s+/g, ' ').slice(0, maxLength);
}
function extractCvDetails(text) {
  const details = {
    summary: cvSection(text, [/^summary$/i, /^موجز$/], [/^experience$/i, /^الخبرة$/, /^education$/i, /^التعليم$/]),
    experience: cvSection(text, [/^experience$/i, /^الخبرة$/], [/^education$/i, /^التعليم$/, /^languages$/i, /^اللغات$/]),
    education: cvSection(text, [/^education$/i, /^التعليم$/], [/^page \d/i, /^languages$/i, /^اللغات$/]),
    skills: cvSection(text, [/^top skills$/i, /^أفضل المهارات$/], [/^summary$/i, /^موجز$/, /^experience$/i, /^الخبرة$/, /^languages$/i, /^اللغات$/], 220)
  };
  if (!details.summary) details.summary = text.replace(/\s+/g, ' ').slice(0, 340);
  return Object.fromEntries(Object.entries(details).filter(([, value]) => value));
}
async function inspectCv(file, criteria) {
  let parser;
  try {
    parser = new PDFParse({ data: file.data });
    const result = await parser.getText(); const text = decodePdfText(result.text || '');
    if (text.length < 40) return { filename: file.filename, status: 'limited', title: 'CV text unavailable', message: 'This PDF does not contain enough selectable text to review. It may be a scanned document.' };
    const evaluated = scoreProfile(text, criteria);
    return { filename: file.filename, status: 'available', title: candidateName(text, file.filename), cvDetails: extractCvDetails(text), ...evaluated, dataQuality: 'standard' };
  } catch {
    return { filename: file.filename, status: 'unavailable', title: 'CV unavailable', message: 'This PDF could not be read.' };
  } finally { if (parser) await parser.destroy(); }
}
function validProfileUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && /(^|\.)linkedin\.com$/i.test(url.hostname) && /^\/in\/[^/]+/i.test(url.pathname);
  } catch { return false; }
}
async function inspectProfile(url, criteria) {
  try {
    const response = await fetch(url, { headers: { Accept: 'text/html' }, signal: AbortSignal.timeout(12000), redirect: 'follow' });
    if (!response.ok) return { url, status: 'unavailable', title: 'Profile unavailable', message: `The public page returned status ${response.status}.` };
    const html = await response.text();
    const title = meta(html, 'og:title') || meta(html, 'title') || '';
    const summary = meta(html, 'og:description') || meta(html, 'description') || '';
    if (!title && !summary) return { url, status: 'limited', title: 'Limited public profile data', message: 'The profile did not expose readable public metadata. It may require sign-in or restrict automated access.' };
    const evaluated = scoreProfile(`${title} ${summary}`, criteria);
    return { url, status: 'available', title, summary, ...evaluated, dataQuality: summary ? 'standard' : 'limited' };
  } catch {
    return { url, status: 'unavailable', title: 'Profile unavailable', message: 'The public page could not be reached or did not allow access.' };
  }
}

http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/healthz') return sendJson(res, 200, { status: 'ok' });
  if (req.method === 'POST' && req.url === '/api/review-cvs') {
    try {
      if (!allowUpload(req)) return sendJson(res, 429, { error: 'Too many CV review requests. Please wait 10 minutes and try again.' });
      const { fields, files } = await readMultipart(req);
      if (!fields.jobDescription?.trim()) return sendJson(res, 400, { error: 'Add a job description.' });
      if (!files.length) return sendJson(res, 400, { error: 'Add at least one PDF CV.' });
      let selectedCriteria;
      try { selectedCriteria = JSON.parse(fields.criteria || '{}'); } catch { return sendJson(res, 400, { error: 'Invalid criteria selection.' }); }
      const criteria = normalizeCriteria(selectedCriteria, fields.jobDescription);
      const profiles = await Promise.all(files.map(file => inspectCv(file, criteria)));
      return sendJson(res, 200, { criteria: Object.values(criteria).flat(), profiles });
    } catch (error) { return sendJson(res, 400, { error: error.message || 'Unable to review CVs.' }); }
  }
  if (req.method === 'POST' && req.url === '/api/review') {
    try {
      const { jobDescription, urls, criteria: selectedCriteria } = await readBody(req);
      if (typeof jobDescription !== 'string' || !jobDescription.trim()) return sendJson(res, 400, { error: 'Add a job description.' });
      if (!Array.isArray(urls) || urls.length < 1 || urls.length > 20) return sendJson(res, 400, { error: 'Add between 1 and 20 profile URLs.' });
      if (!urls.every(validProfileUrl)) return sendJson(res, 400, { error: 'Use public HTTPS LinkedIn profile URLs in the format linkedin.com/in/name.' });
      const criteria = normalizeCriteria(selectedCriteria, jobDescription);
      const profiles = await Promise.all(urls.map(url => inspectProfile(url, criteria)));
      return sendJson(res, 200, { criteria: Object.values(criteria).flat(), profiles });
    } catch (error) { return sendJson(res, 400, { error: error.message || 'Unable to review profiles.' }); }
  }
  const requested = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  const file = path.resolve(root, `.${requested}`);
  if (!file.startsWith(root) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end('Not found'); return; }
  res.writeHead(200, { 'Content-Type': `${types[path.extname(file)] || 'application/octet-stream'}; charset=utf-8` });
  fs.createReadStream(file).pipe(res);
}).listen(process.env.PORT || 4173, '0.0.0.0', () => console.log(`Profile Review is running on port ${process.env.PORT || 4173}`));
