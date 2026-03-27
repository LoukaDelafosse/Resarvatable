// Vercel Cron Function — rappels email 2h avant via Brevo
// Appelé toutes les 30 minutes par Vercel Cron
// GET /api/reminders

const SUPABASE_URL = process.env.SUPABASE_URL || "https://tagpmmmclljaqahldkys.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRhZ3BtbW1jbGxqYXFhaGxka3lzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwMzAzMjcsImV4cCI6MjA4OTYwNjMyN30.1sksxKeQqKV_xXj658rtQx-F3Okj4vCcUAiniWwMY9s";
const CRON_SECRET = process.env.CRON_SECRET;
const BREVO_API_KEY = process.env.BREVO_API_KEY;
const SITE_URL = process.env.SITE_URL || "https://www.normresa.fr";

function getParisOffset(date) {
  const year = date.getUTCFullYear();
  const lastSunMarch = new Date(Date.UTC(year, 2, 31 - new Date(Date.UTC(year, 2, 31)).getUTCDay()));
  const lastSunOct = new Date(Date.UTC(year, 9, 31 - new Date(Date.UTC(year, 9, 31)).getUTCDay()));
  return (date >= lastSunMarch && date < lastSunOct) ? 120 : 60;
}

function toParisTimeStr(date, offsetMinutes) {
  const paris = new Date(date.getTime() + offsetMinutes * 60 * 1000);
  const h = paris.getUTCHours();
  const m = paris.getUTCMinutes();
  return h + "h" + (m === 0 ? "00" : (m < 10 ? "0" + m : "" + m));
}

function toParisDate(date, offsetMinutes) {
  const paris = new Date(date.getTime() + offsetMinutes * 60 * 1000);
  return paris.toISOString().split("T")[0];
}

function buildReminderEmail({ name, restaurant_name, time, covers, reservation_id }) {
  const coversTxt = covers + " personne" + (covers > 1 ? "s" : "");
  const cancelUrl = `${SITE_URL}/cancel.html?id=${reservation_id}`;
  return `
    <div style="font-family:'DM Sans',Arial,sans-serif;max-width:480px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #eee">
      <div style="background:#1C1917;padding:28px 32px;text-align:center">
        <div style="font-size:32px;margin-bottom:8px">⏰</div>
        <div style="color:white;font-size:20px;font-weight:600">Rappel — dans 2h</div>
      </div>
      <div style="padding:28px 32px">
        <p style="font-size:15px;color:#333;margin-bottom:24px">Bonjour <strong>${name}</strong>,</p>
        <p style="font-size:14px;color:#555;margin-bottom:24px;line-height:1.6">
          C'est bientôt l'heure ! Voici votre réservation de ce soir :
        </p>
        <div style="background:#F8F7F5;border-radius:12px;padding:20px 24px;margin-bottom:24px">
          <table style="width:100%;font-size:14px;color:#333;border-collapse:collapse">
            <tr><td style="padding:6px 0;color:#888">Restaurant</td><td style="padding:6px 0;font-weight:600;text-align:right">${restaurant_name}</td></tr>
            <tr><td style="padding:6px 0;color:#888">Heure</td><td style="padding:6px 0;font-weight:600;text-align:right">${time}</td></tr>
            <tr><td style="padding:6px 0;color:#888">Couverts</td><td style="padding:6px 0;font-weight:600;text-align:right">${coversTxt}</td></tr>
          </table>
        </div>
        <div style="margin-top:32px;padding-top:20px;border-top:1px solid #eee;font-size:12px;color:#999;text-align:center">
          Vous souhaitez annuler ?
          <a href="${cancelUrl}" style="color:#C2622A;font-weight:500;display:block;margin-top:6px;font-size:13px">
            Cliquez ici pour annuler votre réservation →
          </a>
          <p style="margin-top:12px;font-size:11px;color:#bbb">Si vous recevez ce message dans vos spams, pensez à déplacer nos emails dans votre boîte principale.</p>
        </div>
        <div style="margin-top:20px;text-align:center;font-size:11px;color:#bbb">
          Propulsé par <a href="${SITE_URL}" style="color:#bbb">Normresa</a>
        </div>
      </div>
    </div>
  `;
}

module.exports = async function handler(req, res) {
  const auth = req.headers["authorization"];
  if (CRON_SECRET && auth !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (!BREVO_API_KEY) {
    return res.status(500).json({ error: "BREVO_API_KEY not configured" });
  }

  const now = new Date();
  const parisOffset = getParisOffset(now);
  const todayParis = toParisDate(now, parisOffset);

  const targetTimes = [];
  for (let offsetMin = 105; offsetMin <= 150; offsetMin += 15) {
    const t = new Date(now.getTime() + offsetMin * 60 * 1000);
    targetTimes.push(toParisTimeStr(t, parisOffset));
  }
  const uniqueTimes = [...new Set(targetTimes)];

  const timeFilter = uniqueTimes.map(t => `"${t}"`).join(",");
  const query = `${SUPABASE_URL}/rest/v1/reservations?date=eq.${todayParis}&status=neq.ann&reminder_sent=eq.false&email=not.is.null&time=in.(${timeFilter})&select=id,guest_name,email,time,covers,date,restaurant_name`;

  const sbRes = await fetch(query, {
    headers: {
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`
    }
  });

  if (!sbRes.ok) {
    const err = await sbRes.text();
    console.error("Supabase error:", err);
    return res.status(500).json({ error: "Supabase query failed" });
  }

  const reservations = await sbRes.json();
  console.log(`[Reminders] ${todayParis} — ${reservations.length} rappel(s) à envoyer (créneaux: ${uniqueTimes.join(", ")})`);

  const results = [];

  for (const r of reservations) {
    try {
      const name = r.guest_name || "vous";
      const htmlContent = buildReminderEmail({
        name,
        restaurant_name: r.restaurant_name,
        time: r.time,
        covers: r.covers,
        reservation_id: r.id
      });

      const emailRes = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: {
          "api-key": BREVO_API_KEY,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          sender: { name: "Normresa", email: "reservations@normresa.fr" },
          to: [{ email: r.email, name }],
          subject: `⏰ Rappel — votre table dans 2h à ${r.time} chez ${r.restaurant_name}`,
          htmlContent
        })
      });

      if (emailRes.ok) {
        await fetch(`${SUPABASE_URL}/rest/v1/reservations?id=eq.${r.id}`, {
          method: "PATCH",
          headers: {
            "apikey": SUPABASE_KEY,
            "Authorization": `Bearer ${SUPABASE_KEY}`,
            "Content-Type": "application/json",
            "Prefer": "return=minimal"
          },
          body: JSON.stringify({ reminder_sent: true })
        });
        results.push({ id: r.id, email: r.email, status: "sent" });
        console.log(`[Reminders] Email envoyé à ${r.email} pour résa ${r.id}`);
      } else {
        const err = await emailRes.text();
        console.error(`[Reminders] Erreur email ${r.email}:`, err);
        results.push({ id: r.id, email: r.email, status: "error", error: err });
      }
    } catch (e) {
      console.error(`[Reminders] Exception pour résa ${r.id}:`, e);
      results.push({ id: r.id, status: "exception", error: e.message });
    }
  }

  return res.status(200).json({ ok: true, processed: results.length, results });
};
