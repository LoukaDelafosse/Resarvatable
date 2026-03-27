// Vercel Serverless Function — mise à jour du restaurant via service role key
// POST /api/update-restaurant
// Body: { restaurantId, payload }

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://tagpmmmclljaqahldkys.supabase.co';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Clé service role (bypass RLS) ou clé anon en fallback
  const authKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;
  if (!authKey) return res.status(500).json({ error: 'Supabase key not configured' });

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch (e) {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  const { restaurantId, payload } = body;
  if (!restaurantId || !payload) {
    return res.status(400).json({ error: 'Missing restaurantId or payload' });
  }

  try {
    const result = await fetch(`${SUPABASE_URL}/rest/v1/restaurants?id=eq.${restaurantId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'apikey': authKey,
        'Authorization': `Bearer ${authKey}`,
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify(payload)
    });

    if (result.ok) {
      return res.status(200).json({ ok: true });
    } else {
      const errText = await result.text();
      console.error('update-restaurant Supabase error:', result.status, errText);
      return res.status(result.status).json({ error: errText });
    }
  } catch (e) {
    console.error('update-restaurant exception:', e);
    return res.status(500).json({ error: e.message });
  }
};
