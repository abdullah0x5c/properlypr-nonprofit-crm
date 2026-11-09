import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { passwordHash } from "../server/auth.mjs";

const username = process.argv[2] || "admin";
if (!/^[a-zA-Z0-9@._+-]{1,120}$/.test(username)) throw Error("Use a simple username or email address.");
const password = randomBytes(24).toString("base64url");
const user = { username, passwordHash:passwordHash(password) };
mkdirSync(".local", {recursive:true, mode:0o700});
const path = `.local/${username}-credentials.json`;
writeFileSync(path, JSON.stringify({username, password, CRM_USERS_JSON:JSON.stringify([user]), SESSION_SECRET:randomBytes(48).toString("base64url")}, null, 2) + "\n", {mode:0o600, flag:"wx"});
console.log(`Created ${path}. Read credentials privately. Add the user object to CRM_USERS_JSON; retain other users and the existing SESSION_SECRET.`);
