// Uptime watchdog for the ERP — a Cloudflare Worker that runs every minute,
// outside Railway, so it still works when the ERP server is down.
//
//   • ERP down for DOWN_MINUTES in a row → one email to every customer
//     ("technical problem, we're on it, sorry") and to the owner.
//   • ERP back up after that → one "back online" email to the same people.
//   • Down during a maintenance window already announced from Platform
//     Console → Notices → only the owner is told (customers already know and
//     get the ERP's own "back online" email).
//
// The customer list is copied from the ERP every few hours while it is up
// (GET /api/system/notify-list, needs WATCHDOG_TOKEN), so it is on hand when
// the ERP is not. State lives in one KV key and is only written when it
// changes (KV free tier allows 1,000 writes a day).
//
// Setup: see README.md next to this file.

const DEFAULT_DOWN_MINUTES = 10;
const LIST_REFRESH_MS = 6 * 60 * 60 * 1000;
const STATE_KEY = "state";

export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(check(env));
  },

  // GET / — quick look at what the watchdog sees (no email addresses shown).
  async fetch(_request, env) {
    const s = await loadState(env);
    return Response.json({
      erp: env.ERP_URL,
      up: s.downSince == null,
      downSince: s.downSince ? new Date(s.downSince).toISOString() : null,
      customersTold: s.notifiedAt ? new Date(s.notifiedAt).toISOString() : null,
      customers: (s.emails ?? []).length,
      listUpdated: s.emailsAt ? new Date(s.emailsAt).toISOString() : null,
    });
  },
};

async function loadState(env) {
  return (await env.STATE.get(STATE_KEY, "json")) ?? {};
}

async function isUp(env) {
  try {
    const res = await fetch(`${env.ERP_URL}/api/healthz`, { signal: AbortSignal.timeout(10_000), cf: { cacheTtl: 0 } });
    if (!res.ok) return false;
    const body = await res.json().catch(() => null);
    return body?.status === "ok";
  } catch {
    return false;
  }
}

export async function check(env, now = Date.now()) {
  const before = await loadState(env);
  const s = { ...before };
  const up = await isUp(env);

  if (up) {
    if (s.notifiedAt) {
      if (!s.planned) await mailCustomers(env, s.emails ?? [], backOnline());
      await mailOwner(env, `ERP is back up`, `The ERP answered again at ${ist(now)} after being down since ${ist(s.downSince)}.`);
    }
    s.downSince = null;
    s.notifiedAt = null;
    s.planned = false;
    if (!s.emailsAt || now - s.emailsAt > LIST_REFRESH_MS) await refreshList(env, s, now);
  } else {
    if (!s.downSince) s.downSince = now;
    const downMinutes = Number(env.DOWN_MINUTES) || DEFAULT_DOWN_MINUTES;
    if (!s.notifiedAt && now - s.downSince >= downMinutes * 60_000) {
      s.notifiedAt = now;
      s.planned = inPlannedWindow(s.notice, now);
      if (s.planned) {
        await mailOwner(env, `ERP down during planned maintenance`, `The ERP has been down since ${ist(s.downSince)}, inside the announced maintenance window. Customers were not emailed again.`);
      } else {
        const sent = await mailCustomers(env, s.emails ?? [], outage());
        await mailOwner(env, `ERP is DOWN — ${sent} customer(s) emailed`, `The ERP has not answered since ${ist(s.downSince)}. ${sent} customer(s) were told. They get a "back online" email automatically when it answers again.`);
      }
    }
  }

  if (JSON.stringify(s) !== JSON.stringify(before)) await env.STATE.put(STATE_KEY, JSON.stringify(s));
  return s;
}

async function refreshList(env, s, now) {
  try {
    const res = await fetch(`${env.ERP_URL}/api/system/notify-list`, {
      headers: { "x-watchdog-token": env.WATCHDOG_TOKEN },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return;
    const body = await res.json();
    if (Array.isArray(body.emails)) s.emails = body.emails;
    s.notice = body.notice ?? null;
    s.emailsAt = now;
  } catch {
    // keep the last good list
  }
}

// An announced window, with a little slack either side.
function inPlannedWindow(notice, now) {
  if (!notice) return false;
  const start = Date.parse(notice.startsAt) - 15 * 60_000;
  const end = Date.parse(notice.endsAt) + 30 * 60_000;
  return now >= start && now <= end;
}

const ist = (t) =>
  new Date(t).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" }) + " IST";

function layout(env, title, body) {
  const brand = env?.BRAND ?? "SHRADHA ERP";
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#0f172a;line-height:1.55;">
    <div style="border-bottom:3px solid #2563eb;padding-bottom:10px;margin-bottom:18px;">
      <span style="font-size:20px;font-weight:bold;color:#2563eb;">${brand}</span>
    </div>
    <h2 style="margin:0 0 12px;font-size:20px;">${title}</h2>
    ${body}
    <p style="color:#64748b;font-size:13px;margin-top:28px;border-top:1px solid #e2e8f0;padding-top:12px;">
      Questions? Just reply to this email.<br/>— Team ${brand}
    </p>
  </div>`;
}

const outage = () => (env) => ({
  subject: `${env.BRAND ?? "SHRADHA ERP"}: temporary technical problem — we're on it`,
  html: layout(env, "We're fixing a technical problem", `
    <p>The ERP is not reachable right now because of a technical problem on our server. Our team is already working on it and it will be back as soon as possible.</p>
    <p>Your data is completely safe — nothing is lost. You'll get another email the moment it's working again.</p>
    <p>तकनीकी दिक्कत की वजह से ERP अभी नहीं खुल रहा है। हम इसे ठीक कर रहे हैं, जल्द ही चालू हो जाएगा। आपका सारा data सुरक्षित है। चालू होते ही आपको email मिल जाएगा।</p>
    <p>Sorry for the inconvenience. / असुविधा के लिए क्षमा करें।</p>`),
});

const backOnline = () => (env) => ({
  subject: `${env.BRAND ?? "SHRADHA ERP"} is back online`,
  html: layout(env, "We're back online", `
    <p>The technical problem is fixed and the ERP is working normally again. You can log in and continue as usual.</p>
    <p>Your data is safe. Thank you for your patience, and sorry for the trouble.</p>
    <p>दिक्कत ठीक हो गई है, ERP फिर से चालू है। आपका सारा data सुरक्षित है। असुविधा के लिए क्षमा करें।</p>`),
});

// One message per address (Brevo messageVersions), so nobody sees the list.
async function mailCustomers(env, emails, template) {
  if (!emails.length) return 0;
  const { subject, html } = template(env);
  let sent = 0;
  for (let i = 0; i < emails.length; i += 500) {
    const chunk = emails.slice(i, i + 500);
    const ok = await brevo(env, {
      subject,
      htmlContent: html,
      messageVersions: chunk.map((email) => ({ to: [{ email }] })),
    });
    if (ok) sent += chunk.length;
  }
  return sent;
}

async function mailOwner(env, subject, text) {
  if (!env.OWNER_EMAIL) return;
  await brevo(env, { subject: `[Watchdog] ${subject}`, htmlContent: `<p>${text}</p><p>${env.ERP_URL}</p>`, to: [{ email: env.OWNER_EMAIL }] });
}

async function brevo(env, payload) {
  try {
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": env.BREVO_API_KEY, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ sender: { name: env.SENDER_NAME ?? env.BRAND ?? "SHRADHA ERP", email: env.SENDER_EMAIL }, ...payload }),
      signal: AbortSignal.timeout(15_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
