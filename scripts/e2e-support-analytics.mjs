// E2E du support (G) et des analytics (H) contre une API lancée sur une base seedée.
// Usage : API=http://localhost:8107/api node scripts/e2e-support-analytics.mjs
// Prérequis : queen@example.com promue admin dans la base de test (UPDATE users SET role='admin' …).
// Relancer rapidement peut déclencher la limite de débit (5 tickets/heure/compte) : redémarrer l'API.
const API = process.env.API || "http://localhost:8107/api";
let passed = 0;
let failed = 0;
const check = (label, cond, extra) => {
    if (cond) { passed++; console.log(`  ✔ ${label}`); }
    else { failed++; console.log(`  ✘ ${label}`, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : ""); }
};
const section = (t) => console.log(`\n## ${t}`);

async function call(method, path, token, body, headers = {}) {
    const res = await fetch(`${API}${path}`, {
        method,
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    let data = null;
    try { data = await res.json(); } catch { /* vide (204) */ }
    return { status: res.status, data };
}
const login = async (email, password) => (await call("POST", "/auth/login", null, { email, password })).data?.token;

const ace = await login("ace@example.com", "hashedpwd1");
const admin = await login("queen@example.com", "hashedpwd2");
const monster = await login("monster@example.com", "hashedpwd3");
check("logins", ace && admin && monster);

// ───────────── G : support ─────────────
section("Support: ticket creation");
check("anonymous cannot create", (await call("POST", "/support/tickets", null, { category: "bug", subject: "x", message: "y" })).status === 401);
check("invalid category -> 400", (await call("POST", "/support/tickets", ace, { category: "nope", subject: "x", message: "y" })).status === 400);
check("empty subject -> 400", (await call("POST", "/support/tickets", ace, { category: "bug", subject: "  ", message: "y" })).status === 400);
check("too long message -> 400", (await call("POST", "/support/tickets", ace, { category: "bug", subject: "x", message: "a".repeat(4001) })).status === 400);
check("too long subject -> 400", (await call("POST", "/support/tickets", ace, { category: "bug", subject: "a".repeat(121), message: "y" })).status === 400);

const created = await call("POST", "/support/tickets", ace, { category: "bug", subject: "Cannot save my game", message: "The save button does nothing." });
check("create -> 201 status new", created.status === 201 && created.data.ticket.status === "new", created);
const ticketId = created.data?.ticket?.id;

section("Support: isolation between users");
const mine = await call("GET", "/support/tickets", ace);
check("owner lists it", mine.status === 200 && mine.data.tickets.some((t) => t.id === ticketId));
check("other user does not list it", !(await call("GET", "/support/tickets", monster)).data.tickets.some((t) => t.id === ticketId));
check("other user GET -> 404", (await call("GET", `/support/tickets/${ticketId}`, monster)).status === 404);
check("other user POST message -> 404", (await call("POST", `/support/tickets/${ticketId}/messages`, monster, { message: "hi" })).status === 404);
check("malformed id -> 404", (await call("GET", "/support/tickets/not-a-uuid", ace)).status === 404);
const detail = await call("GET", `/support/tickets/${ticketId}`, ace);
check("owner sees thread with 1 message", detail.status === 200 && detail.data.ticket.messages.length === 1 && detail.data.ticket.messages[0].isStaff === false, detail.data);

section("Support: admin API");
check("anonymous admin list -> 401", (await call("GET", "/admin/support/tickets")).status === 401);
check("non-admin admin list -> 403", (await call("GET", "/admin/support/tickets", ace)).status === 403);
check("non-admin PATCH -> 403", (await call("PATCH", `/admin/support/tickets/${ticketId}`, ace, { status: "resolved" })).status === 403);
const list = await call("GET", "/admin/support/tickets?status=new&q=save", admin);
check("admin list filters + paginates", list.status === 200 && list.data.items.some((t) => t.id === ticketId) && list.data.pageSize === 20 && list.data.page === 1, list.data);
check("admin list invalid status -> 400", (await call("GET", "/admin/support/tickets?status=zzz", admin)).status === 400);
check("admin search with % is literal", (await call("GET", "/admin/support/tickets?q=%25", admin)).data.total === 0);
check("admin detail 404 on unknown", (await call("GET", "/admin/support/tickets/00000000-0000-4000-8000-000000000000", admin)).status === 404);

const unreadBefore = (await call("GET", "/notifications", ace)).data.unreadCount;
const reply = await call("POST", `/admin/support/tickets/${ticketId}/messages`, admin, { message: "Thanks, we are looking into it." });
check("admin reply -> 201, ticket in_progress", reply.status === 201 && reply.data.ticket.status === "in_progress", reply.data);
const notifs = (await call("GET", "/notifications", ace)).data;
const notif = notifs.notifications.find((n) => n.type === "support_reply" && n.referenceId === ticketId);
check("author notified (support_reply, referenceId = ticket)", !!notif && notifs.unreadCount === unreadBefore + 1, notifs.notifications[0]);
const afterReply = await call("GET", `/support/tickets/${ticketId}`, ace);
check("user sees staff message without staff identity", afterReply.data.ticket.messages.length === 2
    && afterReply.data.ticket.messages[1].isStaff === true && afterReply.data.ticket.messages[1].author === undefined, afterReply.data);
const adminDetail = await call("GET", `/admin/support/tickets/${ticketId}`, admin);
check("admin sees authors", adminDetail.data.ticket.messages.every((m) => m.author?.username) && adminDetail.data.ticket.user.username === "AceHigh", adminDetail.data);

check("PATCH invalid status -> 400", (await call("PATCH", `/admin/support/tickets/${ticketId}`, admin, { status: "closed" })).status === 400);
check("PATCH resolved", (await call("PATCH", `/admin/support/tickets/${ticketId}`, admin, { status: "resolved" })).data?.ticket?.status === "resolved");
const reopened = await call("POST", `/support/tickets/${ticketId}/messages`, ace, { message: "Still broken." });
check("user message on resolved ticket reopens it (new)", reopened.status === 201 && reopened.data.ticket.status === "new", reopened.data);
check("empty user message -> 400", (await call("POST", `/support/tickets/${ticketId}/messages`, ace, { message: " " })).status === 400);

// ───────────── H : analytics ─────────────
section("Analytics: pageview");
const UA = { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) Chrome/120.0 Safari/537.36" };
const pv = (path, referrer, headers = UA) => call("POST", "/analytics/pageview", null, { path, referrer }, headers);
check("public pageview -> 204", (await pv("/games/3f2b1c9e-1111-4222-8333-444455556666/edit?x=1", "https://www.google.com/search?q=poker")).status === 204);
check("join token normalized", (await pv("/join/abcDEF123456", "")).status === 204);
check("unknown path ignored (204)", (await pv("/wp-admin/setup.php", "")).status === 204);
check("bot ignored (204)", (await pv("/learn", "", { "User-Agent": "Googlebot/2.1" })).status === 204);
check("invalid body -> 400", (await call("POST", "/analytics/pageview", null, { path: 12 }, UA)).status === 400);

section("Analytics: admin overview");
check("anonymous overview -> 401", (await call("GET", "/admin/analytics/overview")).status === 401);
check("non-admin overview -> 403", (await call("GET", "/admin/analytics/overview", ace)).status === 403);
const ov = await call("GET", "/admin/analytics/overview", admin);
check("overview 200 with expected shape", ov.status === 200 && ov.data.totals && Array.isArray(ov.data.daily) && Array.isArray(ov.data.topPages) && Array.isArray(ov.data.topReferrers), ov.data);
check("top pages contain normalized paths", ov.data.topPages.some((p) => p.path === "/games/[id]/edit") && ov.data.topPages.some((p) => p.path === "/join/[token]"), ov.data.topPages);
check("no raw ids / query / unknown paths stored", ov.data.topPages.every((p) => !p.path.includes("?") && !/[0-9a-f]{8}-/.test(p.path) && !p.path.includes("wp-admin")), ov.data.topPages);
check("referrer stored as host only", ov.data.topReferrers.some((r) => r.host === "www.google.com"), ov.data.topReferrers);
const learnViews = async () => (await call("GET", "/admin/analytics/overview", admin)).data.topPages.find((p) => p.path === "/learn/rules")?.views ?? 0;
const before = await learnViews();
await pv("/learn/rules", "", { "User-Agent": "Googlebot/2.1" });
await pv("/learn/rules", "", { "User-Agent": "curl/8.4.0" });
check("bots are not counted", (await learnViews()) === before);
await pv("/learn/rules", "", UA);
check("real browser counted once", (await learnViews()) === before + 1);
check("invalid date -> 400", (await call("GET", "/admin/analytics/overview?from=garbage", admin)).status === 400);
check("from after to -> 400", (await call("GET", "/admin/analytics/overview?from=2026-02-01&to=2026-01-01", admin)).status === 400);
const ranged = await call("GET", "/admin/analytics/overview?from=2020-01-01&to=2020-01-31", admin);
check("empty range -> zeros", ranged.status === 200 && ranged.data.totals.signups === 0 && ranged.data.topPages.length === 0, ranged.data);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
