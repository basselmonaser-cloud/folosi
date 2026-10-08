// فلوسي — التشفير والقفل. يعتمد على Web Crypto المدمج في المتصفح فقط.
// المبدأ: مفتاح بيانات عشوائي (AES-GCM 256) يشفّر البيانات، ويُغلَّف هذا المفتاح بمفاتيح مشتقة من:
//   1) رمز PIN أو كلمة مرور (PBKDF2-SHA256، 600 ألف تكرار)
//   2) مفتاح استرداد عشوائي يظهر مرة واحدة
//   3) مفتاح مرور (Passkey) عبر Face ID باستخدام امتداد WebAuthn PRF عند دعمه
const subtle = () => globalThis.crypto.subtle;
export const PIN_ITERATIONS = 600000;
export const RECOVERY_ITERATIONS = 150000;
export const BACKUP_ITERATIONS = 600000;

const enc = new TextEncoder(), dec = new TextDecoder();
export const rand = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));
export function b64(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function unb64(s) { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
const b64url = (buf) => b64(buf).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s) => unb64(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));

export async function deriveKey(secret, salt, iterations, usages = ['encrypt', 'decrypt'], extractable = false) {
  const base = await subtle().importKey('raw', enc.encode(secret.normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, { name: 'AES-GCM', length: 256 }, extractable, usages);
}
async function hkdfKey(secretBytes, info) {
  const base = await subtle().importKey('raw', secretBytes, 'HKDF', false, ['deriveKey']);
  return subtle().deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: enc.encode(info) }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
const importRaw = (raw) => subtle().importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);

export async function encryptBytes(key, bytes, aad) {
  const iv = rand(12);
  const ct = await subtle().encrypt({ name: 'AES-GCM', iv, ...(aad ? { additionalData: enc.encode(aad) } : {}) }, key, bytes);
  return { iv: b64(iv), ct: b64(ct) };
}
export async function decryptBytes(key, { iv, ct }, aad) {
  return new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: unb64(iv), ...(aad ? { additionalData: enc.encode(aad) } : {}) }, key, unb64(ct)));
}
export const encryptJSON = async (key, obj, aad) => encryptBytes(key, enc.encode(JSON.stringify(obj)), aad);
export const decryptJSON = async (key, box, aad) => JSON.parse(dec.decode(await decryptBytes(key, box, aad)));

// ---------- مفتاح الاسترداد ----------
const ALPH = 'ABCDEFGHJKMNPQRSTVWXYZ23456789'; // بدون أحرف ملتبسة
export function newRecoveryCode() {
  const bytes = rand(20); let out = '';
  for (const b of bytes) out += ALPH[b % ALPH.length];
  return out.match(/.{4}/g).join('-'); // 20 حرفًا ≈ 98 بت
}
export const normalizeRecovery = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/O/g, '0').replace(/I|L/g, '1');

// ---------- رمز PIN / كلمة مرور ----------
export function checkSecretStrength(secret, kind) {
  if (kind === 'pin') {
    if (!/^\d{6,12}$/.test(secret)) return 'الرمز يجب أن يكون من 6 إلى 12 رقمًا';
    if (/^(\d)\1+$/.test(secret) || '01234567890123456789'.includes(secret) || '98765432109876543210'.includes(secret)) return 'الرمز سهل التخمين، اختر أرقامًا أخرى';
    return null;
  }
  if (secret.length < 8) return 'كلمة المرور يجب ألا تقل عن 8 أحرف';
  return null;
}

// ---------- الخزنة ----------
export async function createVault(data, { secret, kind }) {
  const raw = rand(32);
  const recovery = newRecoveryCode();
  const keys = {
    pin: await wrapWithSecret(raw, secret, PIN_ITERATIONS, kind),
    recovery: await wrapWithSecret(raw, normalizeRecovery(recovery), RECOVERY_ITERATIONS, 'recovery'),
  };
  const session = { raw, keys };
  const vault = await sealVault(session, data);
  return { vault, session, recovery };
}
async function wrapWithSecret(raw, secret, iterations, kind) {
  const salt = rand(16);
  const kek = await deriveKey(secret, salt, iterations);
  return { kind, salt: b64(salt), iter: iterations, ...(await encryptBytes(kek, raw, 'folosi-key')) };
}
export async function sealVault(session, data) {
  const key = await importRaw(session.raw);
  const updatedAt = data.updatedAt || new Date().toISOString();
  return { v: 1, app: 'folosi', alg: 'AES-GCM-256', updatedAt, keys: session.keys, ...(await encryptJSON(key, data, 'folosi-vault')) };
}
export async function openVaultWithSecret(vault, secret, which = 'pin') {
  const w = vault.keys[which]; if (!w) throw new Error('no-key');
  const s = which === 'recovery' ? normalizeRecovery(secret) : secret;
  const kek = await deriveKey(s, unb64(w.salt), w.iter);
  let raw;
  try { raw = await decryptBytes(kek, w, 'folosi-key'); } catch { const e = new Error('wrong-secret'); e.code = 'wrong'; throw e; }
  return openWithRaw(vault, raw);
}
async function openWithRaw(vault, raw) {
  const data = await decryptJSON(await importRaw(raw), vault, 'folosi-vault');
  return { data, session: { raw, keys: { ...vault.keys } } };
}
// يفتح نسخة مختومة بنفس مفتاح البيانات للجلسة الحالية (المفتاح لا يتغير عند تغيير الرمز)
export async function openWithSession(vault, session) { return decryptJSON(await importRaw(session.raw), vault, 'folosi-vault'); }
export async function changeSecret(session, secret, kind) { session.keys.pin = await wrapWithSecret(session.raw, secret, PIN_ITERATIONS, kind); }
export async function regenerateRecovery(session) {
  const code = newRecoveryCode();
  session.keys.recovery = await wrapWithSecret(session.raw, normalizeRecovery(code), RECOVERY_ITERATIONS, 'recovery');
  return code;
}

// ---------- Face ID عبر Passkey + PRF ----------
export async function passkeyAvailable() {
  try {
    if (!globalThis.PublicKeyCredential || !navigator.credentials?.create) return false;
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch { return false; }
}
// الخطوة 1: تسجيل مفتاح مرور مع التحقق من دعم PRF. يُستدعى مباشرة من ضغطة المستخدم.
export async function registerPasskey() {
  const prfSalt = rand(32);
  const cred = await navigator.credentials.create({ publicKey: {
    rp: { name: 'فلوسي', id: location.hostname }, challenge: rand(32),
    user: { id: rand(16), name: 'folosi-' + new Date().toISOString().slice(0, 10), displayName: 'قفل فلوسي' },
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
    authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'required', userVerification: 'required' },
    timeout: 60000, extensions: { prf: { eval: { first: prfSalt } } } } });
  const ext = cred.getClientExtensionResults?.() || {};
  if (ext.prf?.enabled === false) { const e = new Error('prf-unsupported'); e.code = 'prf'; throw e; }
  return { credId: b64url(cred.rawId), prfSalt, secret: ext.prf?.results?.first || null };
}
// الخطوة 2: تغليف مفتاح البيانات بسر Face ID (لا يُفعَّل شيء قبل نجاح هذه الخطوة)
export async function finishPasskey(session, reg, secret) {
  const kek = await hkdfKey(new Uint8Array(secret), 'folosi-passkey-v1');
  session.keys.passkey = { kind: 'passkey', credId: reg.credId, prfSalt: b64(reg.prfSalt), ...(await encryptBytes(kek, session.raw, 'folosi-key')) };
}
export async function enablePasskey(session) { // للتوافق: تسجيل وتفعيل في خطوة واحدة (المتصفحات المكتبية)
  const reg = await registerPasskey();
  await finishPasskey(session, reg, reg.secret || (await passkeySecret(reg.credId, reg.prfSalt)));
}
export async function passkeySecret(credId, prfSalt) {
  const a = await navigator.credentials.get({ publicKey: { challenge: rand(32), rpId: location.hostname, timeout: 60000, userVerification: 'required',
    allowCredentials: [{ type: 'public-key', id: unb64url(credId) }], extensions: { prf: { eval: { first: prfSalt } } } } });
  const first = a.getClientExtensionResults?.()?.prf?.results?.first;
  if (!first) { const e = new Error('prf-unsupported'); e.code = 'prf'; throw e; }
  return first;
}
export async function openVaultWithPasskey(vault) {
  const w = vault.keys.passkey; if (!w) throw new Error('no-passkey');
  const secret = await passkeySecret(w.credId, unb64(w.prfSalt));
  const kek = await hkdfKey(new Uint8Array(secret), 'folosi-passkey-v1');
  const raw = await decryptBytes(kek, w, 'folosi-key');
  return openWithRaw(vault, raw);
}

// ---------- ملفات النسخ الاحتياطي المشفرة ----------
export async function makeBackupKey(password, saltB64) {
  const salt = saltB64 ? unb64(saltB64) : rand(16);
  return { key: await deriveKey(password, salt, BACKUP_ITERATIONS), salt: b64(salt), iter: BACKUP_ITERATIONS };
}
export async function sealBackup(data, { key, salt, iter }, meta = {}) {
  const box = await encryptJSON(key, data, 'folosi-backup');
  const digest = b64(await subtle().digest('SHA-256', enc.encode(box.ct)));
  return { app: 'folosi', kind: 'backup', format: 1, encrypted: true, createdAt: new Date().toISOString(), schema: data.schema,
    counts: { transactions: data.transactions.length, accounts: data.accounts.length }, ...meta,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', salt, iter }, digest, ...box };
}
export const isEncryptedBackup = (o) => o && o.app === 'folosi' && o.kind === 'backup' && o.encrypted === true && o.ct && o.iv && o.kdf?.salt;
export async function openBackup(file, password, cachedKey) {
  const digest = b64(await subtle().digest('SHA-256', enc.encode(file.ct)));
  if (file.digest && digest !== file.digest) { const e = new Error('corrupt'); e.code = 'corrupt'; throw e; }
  const key = cachedKey && cachedKey.salt === file.kdf.salt ? cachedKey.key : await deriveKey(password, unb64(file.kdf.salt), file.kdf.iter);
  try { return await decryptJSON(key, file, 'folosi-backup'); } catch { const e = new Error('wrong-password'); e.code = 'wrong'; throw e; }
}

// ---------- محاولات فتح القفل (حماية واجهة فقط) ----------
export function lockoutDelay(fails) { return fails < 5 ? 0 : Math.min(15 * 60, 30 * 2 ** (fails - 5)); } // ثوانٍ
