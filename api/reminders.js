// Vercel Cron Function — rappels SMS 2h avant via Brevo
// Appelé 2x par jour par Vercel Cron (12h et 18h Paris)

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

// Convertit un numéro français en format international (+33...)
function toE164(phone) {
  if (!phone) return null;
  const clean = phone.replace(/[\s.\-()]/g, "");
  if (clean.startsWith("+")) return clean;
  if (clean.startsWith("0") && clean.length === 10) return "+33" + clean.slice(1);
  return null;
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

  const lowerTime = toParisTimeStr(new Date(now.getTime() + 105 * 60 * 1000), parisOffset);
  const upperTime = toParisTimeStr(new Date(now.getTime() + 150 * 60 * 1000), parisOffset);

  const query = `${SUPABASE_URL}/rest/v1/reservations?date=eq.${todayParis}&status=neq.ann&reminder_sent=eq.false&time=gte.${lowerTime}&time=lte.${upperTime}&select=id,guest_name,guest_phone,email,time,covers,date,restaurant_name`;

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
      const phone = toE164(r.guest_phone);
      const coversTxt = (r.covers || 1) + " personne" + ((r.covers || 1) > 1 ? "s" : "");
      const cancelUrl = `${SITE_URL}/cancel.html?id=${r.id}`;

      let sent = false;

      // Priorité : SMS si numéro valide
      if (phone) {
        const smsContent = `Bonjour ${name}, rappel : votre table chez ${r.restaurant_name} est dans 2h, à ${r.time} pour ${coversTxt}. Pour annuler, consultez l'email de confirmation (vérifiez vos spams). - Normresa`;

        const smsRes = await fetch("https://api.brevo.com/v3/transactionalSMS/sms", {
          method: "POST",
          headers: {
            "api-key": BREVO_API_KEY,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            sender: "Normresa",
            recipient: phone,
            content: smsContent,
            type: "transactional"
          })
        });

        if (smsRes.ok) {
          sent = true;
          results.push({ id: r.id, phone, status: "sms_sent" });
          console.log(`[Reminders] SMS envoyé à ${phone} pour résa ${r.id}`);
        } else {
          const err = await smsRes.text();
          console.error(`[Reminders] Erreur SMS ${phone}:`, err);
          results.push({ id: r.id, phone, status: "sms_error", error: err });
        }
      }

      // Fallback email si pas de téléphone ou SMS échoué
      if (!sent && r.email) {
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
            htmlContent: `<p>Bonjour ${name},</p><p>Votre table chez <strong>${r.restaurant_name}</strong> est dans 2h — à <strong>${r.time}</strong> pour <strong>${coversTxt}</strong>.</p><p><a href="${cancelUrl}">Annuler ma réservation</a></p>`
          })
        });

        if (emailRes.ok) {
          sent = true;
          results.push({ id: r.id, email: r.email, status: "email_sent" });
          console.log(`[Reminders] Email envoyé à ${r.email} pour résa ${r.id}`);
        } else {
          const err = await emailRes.text();
          console.error(`[Reminders] Erreur email ${r.email}:`, err);
          results.push({ id: r.id, email: r.email, status: "email_error", error: err });
        }
      }

      if (sent) {
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
      }

    } catch (e) {
      console.error(`[Reminders] Exception pour résa ${r.id}:`, e);
      results.push({ id: r.id, status: "exception", error: e.message });
    }
  }

  return res.status(200).json({ ok: true, processed: results.length, results });
};
