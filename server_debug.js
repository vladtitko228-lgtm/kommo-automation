const express = require('express');
const https = require('https');

const app = express();
app.use(express.json());

const CONFIG = {
  kommoSubdomain: 'supremes',
  kommoToken: 'XAknRcVtkLAYfCYulqEgdX23ktj6npheHQ15UQWi0v4jnvsw6pr5hD9oUfEJJMqk',
  claudeKey: process.env.CLAUDE_API_KEY || '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',
  port: process.env.PORT || 3000,
};

function kommoRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: `${CONFIG.kommoSubdomain}.kommo.com`,
      path: path,
      method: method,
      headers: {
        'Authorization': `Bearer ${CONFIG.kommoToken}`,
        'Content-Type': 'application/json',
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          console.error('Parse error:', e.message);
          resolve({ error: 'Parse error', raw: data.substring(0, 100) });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/status', (req, res) => {
  res.json({
    status: 'running',
    kommo: 'connected',
    claude: 'ready',
    message: 'Kommo CRM Bot is working!',
  });
});

// Показать ВСЕ сделки и их status_id
app.get('/all-deals', async (req, res) => {
  try {
    console.log('🔍 Загружаю ВСЕ сделки...');
    
    const dealsResponse = await kommoRequest('GET', '/api/v4/leads?limit=200&page=1');
    
    console.log('Response keys:', Object.keys(dealsResponse));
    
    let leadsList = [];
    if (dealsResponse._embedded && dealsResponse._embedded.leads) {
      leadsList = dealsResponse._embedded.leads;
    } else if (Array.isArray(dealsResponse)) {
      leadsList = dealsResponse;
    } else {
      return res.json({ 
        status: 'error', 
        message: 'Неожиданная структура API',
        received: Object.keys(dealsResponse),
        sample: JSON.stringify(dealsResponse).substring(0, 300)
      });
    }

    if (leadsList.length === 0) {
      return res.json({ status: 'error', message: 'Нет сделок' });
    }

    console.log(`📊 Найдено ${leadsList.length} сделок`);

    // Сгруппировать по status_id
    const byStatus = {};
    leadsList.forEach(lead => {
      const sid = lead.status_id || 'unknown';
      if (!byStatus[sid]) byStatus[sid] = [];
      byStatus[sid].push({
        id: lead.id,
        name: lead.name,
        status_id: lead.status_id,
      });
    });

    const summary = Object.entries(byStatus).map(([sid, deals]) => ({
      status_id: sid,
      count: deals.length,
      sample_deals: deals.slice(0, 2).map(d => `${d.id}: ${d.name}`),
    }));

    res.json({
      status: 'success',
      totalDeals: leadsList.length,
      uniqueStatuses: Object.keys(byStatus).length,
      summary: summary,
    });

  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).json({ status: 'error', error: error.message });
  }
});

app.listen(CONFIG.port, () => {
  console.log(`✅ Kommo Bot запущен на порту ${CONFIG.port}`);
  console.log(`📊 /status`);
  console.log(`🏥 /health`);
  console.log(`📈 /all-deals - ВСЕ СДЕЛКИ`);
});
