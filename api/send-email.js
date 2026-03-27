// Vercel Serverless Function — envoi d'emails via Resend
// POST /api/send-email
// Body: { type: "confirmation"|"reminder", to, name, restaurant_name, date, time, covers, reservation_id, city }

const SITE_URL = process.env.SITE_URL || "https://normresa.fr";

function formatDate(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

function emailTemplate({ type, name, restaurant_name, date, time, covers, reservation_id, city }) {
  const dateFormatted = formatDate(date);
  const cancelUrl = `${SITE_URL}/cancel.html?id=${reservation_id}`;
  const coversTxt = covers + " personne" + (covers > 1 ? "s" : "");

  const footer = `
    <div style="margin-top:32px;padding-top:20px;border-top:1px solid #eee;font-size:12px;color:#999;text-align:center">
      Vous souhaitez annuler ?
      <a href="${cancelUrl}" style="color:#C2622A;font-weight:500;display:block;margin-top:6px;font-size:13px">
        Cliquez ici pour annuler votre réservation →
      </a>
    </div>
    <div style="margin-top:20px;text-align:center;font-size:11px;color:#bbb">
      Propulsé par <a href="${SITE_URL}" style="color:#bbb">Normresa</a>
    </div>
  `;

  if (type === "confirmation") {
    return {
      subject: `✓ Réservation confirmée — ${restaurant_name}`,
      html: `
        <div style="font-family:'DM Sans',Arial,sans-serif;max-width:480px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #eee">
          <div style="background:#C2622A;padding:28px 32px;text-align:center">
            <div style="font-size:32px;margin-bottom:8px">✓</div>
            <div style="color:white;font-size:20px;font-weight:600">Réservation confirmée</div>
          </div>
          <div style="padding:28px 32px">
            <p style="font-size:15px;color:#333;margin-bottom:24px">Bonjour <strong>${name}</strong>,</p>
            <p style="font-size:14px;color:#555;margin-bottom:24px;line-height:1.6">
              Votre table est réservée. Voici le récapitulatif :
            </p>
            <div style="background:#F8F7F5;border-radius:12px;padding:20px 24px;margin-bottom:24px">
              <table style="width:100%;font-size:14px;color:#333;border-collapse:collapse">
                <tr><td style="padding:6px 0;color:#888">Restaurant</td><td style="padding:6px 0;font-weight:600;text-align:right">${restaurant_name}</td></tr>
                ${city ? `<tr><td style="padding:6px 0;color:#888">Ville</td><td style="padding:6px 0;font-weight:600;text-align:right">${city}</td></tr>` : ""}
                <tr><td style="padding:6px 0;color:#888">Date</td><td style="padding:6px 0;font-weight:600;text-align:right;text-transform:capitalize">${dateFormatted}</td></tr>
                <tr><td style="padding:6px 0;color:#888">Heure</td><td style="padding:6px 0;font-weight:600;text-align:right">${time}</td></tr>
                <tr><td style="padding:6px 0;color:#888">Couverts</td><td style="padding:6px 0;font-weight:600;text-align:right">${coversTxt}</td></tr>
              </table>
            </div>
            <p style="font-size:13px;color:#888;line-height:1.6">
              Vous recevrez un rappel par email 2h avant votre réservation.
            </p>
            ${footer}
          </div>
        </div>
      `
    };
  }

  if (type === "reminder") {
    return {
      subject: `⏰ Rappel — votre table ce soir à ${time} chez ${restaurant_name}`,
      html: `
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
                ${city ? `<tr><td style="padding:6px 0;color:#888">Ville</td><td style="padding:6px 0;font-weight:600;text-align:right">${city}</td></tr>` : ""}
                <tr><td style="padding:6px 0;color:#888">Heure</td><td style="padding:6px 0;font-weight:600;text-align:right">${time}</td></tr>
                <tr><td style="padding:6px 0;color:#888">Couverts</td><td style="padding:6px 0;font-weight:600;text-align:right">${coversTxt}</td></tr>
              </table>
            </div>
            ${footer}
          </div>
        </div>
      `
    };
  }

  return null;
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_API_KEY) return res.status(500).json({ error: "RESEND_API_KEY not configured" });

  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  } catch (e) {
    return res.status(400).json({ error: "Invalid JSON" });
  }

  const { type, to, name, restaurant_name, date, time, covers, reservation_id, city } = body;
  if (!type || !to || !name || !restaurant_name) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const template = emailTemplate({ type, name, restaurant_name, date, time, covers, reservation_id, city });
  if (!template) return res.status(400).json({ error: "Unknown email type" });

  try {
    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: "Normresa <reservations@normresa.fr>",
        to: [to],
        subject: template.subject,
        html: template.html
      })
    });

    const emailData = await emailRes.json();
    if (!emailRes.ok) {
      console.error("Resend error:", emailData);
      return res.status(502).json({ error: "Email sending failed", details: emailData });
    }

    return res.status(200).json({ ok: true, id: emailData.id });
  } catch (e) {
    console.error("Email error:", e);
    return res.status(500).json({ error: e.message });
  }
};
