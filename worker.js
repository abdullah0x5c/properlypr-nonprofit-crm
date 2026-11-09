import { actions, todayET, transition } from "./workflow.js";
const html = /*APP_HTML*/ null;
const fields = [
  "contact",
  "phone",
  "email",
  "website",
  "address",
  "focus",
  "mission",
  "research",
  "researchSource",
  "owner",
];
const bad = (message, status = 400) => {
  throw Object.assign(Error(message), { status });
};
const json = (data, status = 200) =>
  Response.json(data, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
function clean(value, limit) {
  if (typeof value !== "string" || value.length > limit)
    bad("The text exceeds the field limit.");
  return value.trim();
}
function validId(id) {
  return typeof id === "string" && /^[\da-f-]{36}$/i.test(id);
}
async function detail(db, id) {
  const row = await db
    .prepare("SELECT * FROM organizations WHERE id=?")
    .bind(id)
    .first();
  if (!row) bad("Organization not found.", 404);
  const o = JSON.parse(row.profile);
  const { results } = await db
    .prepare(
      "SELECT id,stamp,body,author FROM entries WHERE organization=? AND kind='note' ORDER BY stamp DESC,id",
    )
    .bind(id)
    .all();
  return { ...o, rev: row.revision, actions: actions(o), savedNotes: results };
}
async function update(db, id, payload, author) {
  if (!validId(payload.requestId)) bad("Reload this record and try again.");
  const data = await detail(db, id);
  const { savedNotes, rev, actions: available, ...org } = data;
  const stamp = new Date().toISOString();
  const prior = org.history.find((v) => v.requestId === payload.requestId);
  if (prior) return data;
  if (payload.rev !== rev)
    bad("This record changed. Reopen it before saving.", 409);
  let updated = { ...org },
    title,
    notes = "";
  if (payload.type === "profile") {
    const changes = [];
    for (const [key, raw] of Object.entries(payload.fields || {})) {
      if (!fields.includes(key)) bad("Unknown profile field.");
      const value = clean(raw, 4500);
      if (value && key === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
        bad("Enter a valid email address.");
      if (value && ["website", "researchSource"].includes(key)) {
        let u;
        try {
          u = new URL(value);
        } catch {
          bad("Enter a full web address.");
        }
        if (!["https:", "http:"].includes(u.protocol))
          bad("Use an http or https address.");
        if (key === "website")
          updated.domain = u.hostname.replace(/^www\./, "");
      }
      if (key === "website" && !value) updated.domain = "";
      if (updated[key] !== value) {
        changes.push(key);
        updated[key] = value;
      }
    }
    if (!changes.length) return data;
    title = "Profile updated";
    notes = changes.join(", ");
  } else if (payload.type === "person") {
    const person = clean(payload.name, 240),
      role = clean(payload.role || "", 200),
      year = clean(payload.year, 4),
      source = clean(payload.source || "", 1000);
    if (
      !person ||
      !/^\d{4}$/.test(year) ||
      Number(year) > new Date().getUTCFullYear()
    )
      bad("Enter the person’s name and filing year.");
    if (source) {
      let u;
      try {
        u = new URL(source);
      } catch {
        bad("Enter the full source URL.");
      }
      if (!["https:", "http:"].includes(u.protocol))
        bad("Use an http or https source.");
    }
    if (
      org.people.some(
        (p) =>
          p[0].toLowerCase() === person.toLowerCase() &&
          p[1].toLowerCase() === role.toLowerCase() &&
          p[2] === year,
      )
    )
      bad("This person and filing year are already listed.");
    updated.people = [...org.people, [person, role, year, source]];
    title = "Board or officer record added";
    notes = [person, role, year].filter(Boolean).join(" · ");
  } else if (payload.type === "outcome") {
    const asOf = payload.asOf || todayET();
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(asOf) ||
      asOf > todayET() ||
      new Date(asOf + "T12:00:00Z").toISOString().slice(0, 10) !== asOf
    )
      bad("Enter today or an earlier valid date.");
    const last = org.history.filter((r) => r.effective).at(-1);
    if (last && asOf < last.effective)
      bad("This date precedes the last recorded action.");
    updated = transition(org, payload.action, asOf, payload.agreed || "");
    title = payload.action;
    notes = clean(payload.notes || "", 6000);
  } else bad("Unknown action.");
  updated.history = [
    ...org.history,
    {
      date: stamp,
      effective: payload.asOf || todayET(),
      text: title,
      notes,
      by: author,
      requestId: payload.requestId,
    },
  ];
  const r = await db
    .prepare(
      "UPDATE organizations SET profile=?,revision=revision+1 WHERE id=? AND revision=?",
    )
    .bind(JSON.stringify(updated), id, rev)
    .run();
  if (!r.meta.changes)
    bad(
      "Another editor saved first. Reopen the profile to see the change.",
      409,
    );
  return detail(db, id);
}
export default {
  async fetch(request, env) {
    try {
      const { pathname, origin } = new URL(request.url);
      const importAccess =
        Boolean(env.CRM_IMPORT_KEY) &&
        request.headers.get("X-CRM-Import") === env.CRM_IMPORT_KEY;
      const visitor = request.headers.get("oai-authenticated-user-id");
      const author =
        request.headers.get("oai-authenticated-user-email") ||
        visitor ||
        "CRM verification";
      if (request.method === "GET" && pathname === "/") {
        return new Response(html, {
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "private, no-store",
          },
        });
      }
      if (!visitor && !importAccess)
        return json({ error: "Sign in to open this workspace." }, 401);
      if (
        request.method === "POST" &&
        ((request.headers.get("Origin") &&
          request.headers.get("Origin") !== origin) ||
          !request.headers.get("Content-Type")?.includes("application/json"))
      )
        return json({ error: "Invalid write request." }, 403);
      const db = env.DB;
      if (pathname === "/api/import" && request.method === "POST") {
        if (!importAccess) bad("Import is restricted.", 403);
        const rows = await request.json();
        if (!Array.isArray(rows) || !rows.length || rows.length > 40)
          bad("Invalid import batch.");
        const inserts = rows.map((o) => {
          if (
            !/^\d{9}$/.test(o.id) ||
            !o.name ||
            !Array.isArray(o.people) ||
            !Array.isArray(o.history)
          )
            bad("Invalid organization.");
          return db
            .prepare(
              "INSERT OR IGNORE INTO organizations(id,name,profile) VALUES(?,?,?)",
            )
            .bind(o.id, o.name, JSON.stringify(o));
        });
        await db.batch(inserts);
        return json({ accepted: rows.length });
      }
      if (pathname === "/api/directory" && request.method === "GET") {
        const keys = [
          "tab",
          "status",
          "step",
          "due",
          "domain",
          "email",
          "phone",
          "agreed",
          "owner",
        ];
        const projections = keys
          .map((k) => "json_extract(profile,'$." + k + "') AS " + k)
          .join(",");
        const { results } = await db
          .prepare(
            "SELECT id,name," +
              projections +
              " FROM organizations ORDER BY name",
          )
          .all();
        return json({ orgs: results, today: todayET() });
      }
      if (pathname === "/api/batch" && request.method === "POST") {
        const p = await request.json();
        if (
          !validId(p.requestId) ||
          !Array.isArray(p.ids) ||
          !p.ids.length ||
          p.ids.length > 100
        )
          bad("Select 1 to 100 available organizations.");
        const updates = [];
        let already = 0;
        const day = todayET();
        const ids = [...new Set(p.ids)];
        if (ids.some((id) => !/^\d{9}$/.test(id))) bad("Invalid EIN.");
        const { results: roster } = await db
          .prepare(
            "SELECT id,profile,revision FROM organizations WHERE id IN (" +
              ids.map(() => "?").join(",") +
              ")",
          )
          .bind(...ids)
          .all();
        for (const row of roster) {
          const id = row.id,
            org = JSON.parse(row.profile);
          if (org.history.some((h) => h.requestId === p.requestId)) {
            already++;
            continue;
          }
          if (org.tab !== "Available") continue;
          const o = transition(org, "Add to first calls", day, "");
          o.history = [
            ...org.history,
            {
              text: "Added to first calls",
              date: new Date().toISOString(),
              effective: day,
              by: author,
              requestId: p.requestId,
            },
          ];
          updates.push(
            db
              .prepare(
                "UPDATE organizations SET profile=?,revision=revision+1 WHERE id=? AND revision=?",
              )
              .bind(JSON.stringify(o), id, row.revision),
          );
        }
        const results = updates.length ? await db.batch(updates) : [];
        return json({
          added: already + results.reduce((n, r) => n + r.meta.changes, 0),
        });
      }
      if (pathname === "/api/org" && request.method === "POST") {
        const p = await request.json(),
          name = clean(p.name, 240),
          id = clean(p.id, 16).replace(/[- ]/g, "");
        if (!name || !/^\d{9}$/.test(id) || !validId(p.requestId))
          bad("Enter an organization name and a nine-digit EIN.");
        const initial = {
          id,
          name,
          tab: "Available",
          status: "Available",
          step: "Select for first call",
          due: "",
          people: [],
          notes: [],
          history: [
            {
              date: new Date().toISOString(),
              text: "Organization added",
              by: author,
              requestId: p.requestId,
            },
          ],
        };
        const r = await db
          .prepare(
            "INSERT OR IGNORE INTO organizations(id,name,profile) VALUES(?,?,?)",
          )
          .bind(id, name, JSON.stringify(initial))
          .run();
        const o = await detail(db, id);
        if (
          !r.meta.changes &&
          !o.history.some((h) => h.requestId === p.requestId)
        )
          bad("There is already an organization with this EIN.", 409);
        return json(o);
      }
      const match = pathname.match(/^\/api\/org\/(\d{9})(?:\/(note|update))?$/);
      if (!match) bad("Page not found.", 404);
      const [, id, action] = match;
      if (request.method === "GET" && !action)
        return json(await detail(db, id));
      if (request.method !== "POST") bad("Unsupported method.", 405);
      const p = await request.json();
      if (action === "note") {
        const note = clean(p.body, 6000);
        if (!note || !validId(p.requestId)) bad("Enter a note.");
        const previous = await db
          .prepare("SELECT organization,body FROM entries WHERE id=?")
          .bind(p.requestId)
          .first();
        if (
          previous &&
          (previous.organization !== id || previous.body !== note)
        )
          bad("This note identifier is already used.", 409);
        await db
          .prepare(
            "INSERT OR IGNORE INTO entries(id,organization,kind,stamp,author,body) VALUES(?,?,'note',?,?,?)",
          )
          .bind(p.requestId, id, new Date().toISOString(), author, note)
          .run();
        return json(await detail(db, id));
      }
      if (action === "update") return json(await update(db, id, p, author));
      bad("Unsupported operation.", 404);
    } catch (err) {
      return json(
        { error: err.message || "Unable to load this record." },
        err.status || 400,
      );
    }
  },
};
