import { randomBytes, scryptSync, timingSafeEqual, createHmac, createHash } from "node:crypto";

export function passwordHash(password) {
  const salt = randomBytes(16).toString("hex");
  return salt + ":" + scryptSync(password, salt, 64).toString("hex");
}
export function authenticate(users, username, password) {
  const user = users.find(u => u.username === username);
  const stored = user?.passwordHash || "00000000000000000000000000000000:" + "0".repeat(128);
  const [salt, hash] = stored.split(":");
  const actual = scryptSync(password, salt, 64);
  return timingSafeEqual(actual, Buffer.from(hash, "hex")) && user ? user : null;
}
export function validateUsers(users) {
  if (!Array.isArray(users) || !users.length || users.length > 100 || users.some(u => !/^[a-zA-Z0-9@._+-]{1,120}$/.test(u.username || "") || !/^[a-f0-9]{32}:[a-f0-9]{128}$/.test(u.passwordHash || "")) || new Set(users.map(u => u.username)).size !== users.length)
    throw Error("CRM_USERS_JSON must contain unique usernames and scrypt password hashes. Use scripts/create-user.mjs.");
  return users;
}
const version = u => createHash("sha256").update(u.passwordHash).digest("hex").slice(0,16);
const signature = (payload, secret) => createHmac("sha256", secret).update(payload).digest("base64url");
export function makeSession(user, secret) {
  const data = Buffer.from(JSON.stringify({sub:user.username, v:version(user), exp:Math.floor(Date.now()/1000)+8*3600})).toString("base64url");
  return data + "." + signature(data, secret);
}
export function readSession(token, secret, users) {
  try {
    if (typeof token !== "string" || token.length > 1000) return null;
    const [data, sig, extra] = token.split(".");
    if (!sig || extra || !/^[\w-]+$/.test(data)) return null;
    const expected = Buffer.from(signature(data, secret));
    const actual = Buffer.from(sig);
    if (actual.length !== expected.length || !timingSafeEqual(expected, actual)) return null;
    const payload = JSON.parse(Buffer.from(data, "base64url").toString());
    return users.find(u => u.username === payload.sub && payload.v === version(u) && payload.exp > Date.now()/1000) || null;
  } catch { return null; }
}
