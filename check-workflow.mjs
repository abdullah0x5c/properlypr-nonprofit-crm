import assert from "node:assert/strict";
import { transition, actions } from "./workflow.js";
const act = (o, a, d, t = "") => transition(o, a, d, t);
let o = {
  tab: "First call",
  status: "Awaiting first call",
  step: "Make first call",
  history: [],
  email: "test@example.org",
};
o = act(o, "Email requested", "2026-11-06");
const planned = [];
for (const [a, day] of [
  ["Email sent", "2026-11-06"],
  ["Call done", "2026-11-10"],
  ["Email sent", "2026-11-12"],
  ["Call done", "2026-11-17"],
  ["Email sent", "2026-11-20"],
  ["Call done", "2026-11-26"],
  ["Email sent", "2026-12-07"],
]) {
  planned.push(o.due);
  o = act(o, a, day);
}
assert.deepEqual(planned, [
  "2026-11-06",
  "2026-11-10",
  "2026-11-12",
  "2026-11-17",
  "2026-11-20",
  "2026-11-26",
  "2026-12-07",
]);
assert.equal(o.tab, "Review and Nurture");
let c = {
  tab: "First call",
  status: "Awaiting first call",
  step: "Make first call",
  history: [],
};
c = act(c, "No answer", "2026-11-06");
assert.equal(c.due, "2026-11-10");
assert.throws(() => act(c, "No answer", "2026-11-06"));
c = act(c, "No answer", "2026-11-10");
assert.equal(c.due, "2026-11-13");
c = act(c, "No answer", "2026-11-13");
assert.equal(c.tab, "Review and Nurture");
let m = act(c, "Meeting booked", "2026-11-13", "2026-11-20T14:00");
assert.equal(m.step, "Confirm meeting");
m = act(m, "Invite sent", "2026-11-13");
assert.equal(m.due, "2026-11-19");
m = act(m, "Confirmation call done", "2026-11-19");
assert.equal(m.step, "Joining reminder");
m = act(m, "No-show", "2026-11-20");
assert.equal(m.step, "Follow-up email 1");
const quiet = act(c, "Do not contact", "2026-11-13");
assert.deepEqual(actions(quiet), []);
console.log(
  "Passed seven anchored business-day touches, three cold calls, weekend deadlines, meeting reminders, no-show follow-up, and do-not-contact.",
);
