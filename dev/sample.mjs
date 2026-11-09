import { todayET } from "../workflow.js";

export function loadExamples(db) {
  if (db.prepare("SELECT COUNT(*) AS n FROM organizations").first().n) return;
  const today = todayET();
  const examples = [
    [
      "000000001",
      "Paper Lantern Demo",
      "Email Sequence",
      "Information",
      "Email 1",
    ],
    [
      "000000002",
      "Copper Kite Demo",
      "Cold Call Sequence",
      "Cold calls",
      "Cold call 2",
    ],
    [
      "000000003",
      "Willow House Demo",
      "Available",
      "Available",
      "Select for first call",
    ],
  ];
  db.batch(
    examples.map(([id, name, tab, status, step]) => {
      const profile = {
        id,
        name,
        tab,
        status,
        step,
        due: tab === "Available" ? "" : today,
        domain: "example.org",
        email: "rep@example.org",
        people: [],
        notes: [],
        history: [],
      };
      return db
        .prepare("INSERT INTO organizations(id,name,profile) VALUES(?,?,?)")
        .bind(id, name, JSON.stringify(profile));
    }),
  );
}
