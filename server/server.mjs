import http from "node:http";
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { openDatabase } from "../dev/database.mjs";
import app from "../dist/server/index.js";
import { authenticate, validateUsers, makeSession, readSession } from "./auth.mjs";

function loginPage(error = "") {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign in · ProperlyPR</title><style>body{font:16px/1.5 system-ui;background:#faf9f5;color:#183f34;max-width:400px;margin:10vh auto;padding:24px}label{display:block;margin:18px 0}input,button{box-sizing:border-box;width:100%;padding:12px;font:inherit;border:1px solid #bbc9c1;border-radius:6px}button{background:#183f34;color:white}p[role]{color:#9e2929}</style></head><body><p>PROPERLYPR / TEAM WORKSPACE</p><h1>Welcome back</h1><p>Sign in to manage your nonprofit outreach.</p><p role="alert">${error}</p><form action="/login" method="post"><label>Username<input name="username" autocomplete="username" maxlength="120" required></label><label>Password<input name="password" type="password" autocomplete="current-password" maxlength="256" required></label><button>Sign in</button></form></body></html>`;
}

export function createCRMServer({ db, origin, users, secret }) {
  validateUsers(users);
  if (!secret || secret.length < 32) throw Error("SESSION_SECRET must contain at least 32 characters.");
  const base = new URL(origin);
  if (base.origin !== origin || !["http:","https:"].includes(base.protocol)) throw Error("APP_ORIGIN must be an http(s) origin without a trailing slash.");
  const secure = base.protocol === "https:";
  const cookieName = secure ? "__Host-crm" : "crm_session";
  const cookie = (token, maxAge = 28800) => `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
  const attempts = new Map();
  let totalAttempts = 0, windowStart = Date.now();
  return http.createServer(async (incoming, outgoing) => {
    const nonce = randomBytes(18).toString("base64");
    outgoing.setHeader("X-Content-Type-Options", "nosniff");
    outgoing.setHeader("Referrer-Policy", "same-origin");
    outgoing.setHeader("X-Frame-Options", "DENY");
    outgoing.setHeader("Cache-Control", "private, no-store");
    outgoing.setHeader("Content-Security-Policy", `default-src 'self'; script-src 'nonce-${nonce}'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`);
    if (secure) outgoing.setHeader("Strict-Transport-Security", "max-age=31536000");
    const send = (status, body, type = "text/plain; charset=utf-8") => { outgoing.writeHead(status, {"Content-Type":type}); outgoing.end(body); };
    const redirect = path => { outgoing.writeHead(303, {Location:path}); outgoing.end(); };
    try {
      if (!incoming.url.startsWith("/") || incoming.url.startsWith("//")) return send(400, "Invalid path.");
      const path = new URL(incoming.url, origin).pathname;
      if (incoming.method === "GET" && path === "/healthz") {
        await db.prepare("SELECT 1 FROM organizations LIMIT 1").all();
        return send(200, '{"ok":true}', "application/json");
      }
      if (incoming.headers.host !== base.host) return send(400, "Invalid host.");
      if (!["GET", "POST"].includes(incoming.method)) return send(405, "Unsupported method.");
      if (incoming.method === "POST" && incoming.headers.origin !== origin) return send(403, "Invalid request origin.");
      const token = (incoming.headers.cookie || "").split(";").map(s => s.trim()).find(s => s.startsWith(cookieName + "="))?.slice(cookieName.length + 1);
      const user = readSession(token, secret, users);
      if (path === "/login" && incoming.method === "GET") {
        if (user) return redirect("/");
        return send(200, loginPage(), "text/html; charset=utf-8");
      }
      if (path === "/logout" && incoming.method === "POST") {
        outgoing.setHeader("Set-Cookie", cookie("", 0));
        return redirect("/login");
      }
      if (!(path === "/login" && incoming.method === "POST") && !user) {
        if (path.startsWith("/api/")) return send(401, '{"error":"Sign in to open this workspace."}', "application/json");
        return redirect("/login");
      }
      const chunks = []; let length = 0;
      for await (const chunk of incoming) {
        length += chunk.length;
        if (length > (path === "/login" ? 4096 : 2*1024*1024)) { send(413, "Request too large."); incoming.resume(); return; }
        chunks.push(chunk);
      }
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      if (path === "/login" && incoming.method === "POST") {
        if (!incoming.headers["content-type"]?.startsWith("application/x-www-form-urlencoded")) return send(415, "Use the sign-in form.");
        const now = Date.now();
        if (now - windowStart > 15*60*1000) { windowStart = now; totalAttempts = 0; attempts.clear(); }
        // Railway appends the client address; never trust a caller's leftmost forwarded address.
        const ip = incoming.headers["x-forwarded-for"]?.split(",").at(-1)?.trim() || incoming.socket.remoteAddress;
        const count = attempts.get(ip) || 0;
        if (count >= 10 || totalAttempts >= 200) { outgoing.setHeader("Retry-After", "900"); return send(429, "Too many sign-in attempts. Try again in 15 minutes."); }
        totalAttempts++; attempts.set(ip, count + 1);
        const fields = new URLSearchParams(body?.toString());
        const username = fields.get("username") || "", password = fields.get("password") || "";
        const authenticated = username.length <= 120 && password.length <= 256 && authenticate(users, username, password);
        if (!authenticated) return send(401, loginPage("Username or password is incorrect."), "text/html; charset=utf-8");
        outgoing.setHeader("Set-Cookie", cookie(makeSession(authenticated, secret)));
        return redirect("/");
      }
      // Build identity headers from the verified session. Discard all caller-supplied identities/import keys.
      const headers = new Headers({"oai-authenticated-user-id":user.username, "oai-authenticated-user-email":user.username});
      for (const key of ["content-type", "origin"]) if (incoming.headers[key]) headers.set(key, incoming.headers[key]);
      const response = await app.fetch(new Request(new URL(incoming.url, origin), {method:incoming.method, headers, body}), {DB:db});
      for (const [key, value] of response.headers) outgoing.setHeader(key, value);
      let output = Buffer.from(await response.arrayBuffer());
      if (response.headers.get("content-type")?.includes("text/html")) output = Buffer.from(output.toString().replaceAll("<script>", `<script nonce="${nonce}">`));
      outgoing.writeHead(response.status); outgoing.end(output);
    } catch (error) {
      console.error("CRM request failed:", error.message);
      if (!outgoing.headersSent) send(500, "Unable to complete this request.");
      else outgoing.end();
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const origin = process.env.APP_ORIGIN;
  if (!origin || (process.env.NODE_ENV === "production" && !origin.startsWith("https://"))) throw Error("Set APP_ORIGIN to the public HTTPS URL.");
  const filename = resolve(process.env.CRM_DATABASE_PATH || ".local/crm.sqlite");
  if (process.env.RAILWAY_ENVIRONMENT_ID) {
    const mount = process.env.RAILWAY_VOLUME_MOUNT_PATH;
    if (!mount || !filename.startsWith(resolve(mount) + sep)) throw Error("Mount a Railway volume and put CRM_DATABASE_PATH inside it.");
  }
  mkdirSync(dirname(filename), {recursive:true});
  const db = openDatabase(filename);
  const server = createCRMServer({db, origin, users:JSON.parse(process.env.CRM_USERS_JSON || "[]"), secret:process.env.SESSION_SECRET});
  server.listen(Number(process.env.PORT || 8080), "0.0.0.0", () => console.log("ProperlyPR CRM listening; migrations applied; database ready."));
  server.requestTimeout = 30000;
  server.headersTimeout = 15000;
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { server.close(() => { db.close(); process.exit(0); }); setTimeout(() => process.exit(1), 10000).unref(); });
}
