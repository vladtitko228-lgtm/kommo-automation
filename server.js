const express = require('express');
const https = require('https');

const app = express();
app.use(express.json());

const CONFIG = {
  kommoSubdomain: 'supremes',
  kommoToken: 'eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiIsImp0aSI6Ijg4NzRkYjMyZWMzZDEwNzhkMTBmYTBjYzBhMjAyNzAzMzllM2JiZWIzYjBlNGY4NjRlMWJlZTE5N2Y4Zjc1YzRlZmYxMGIxYjE4YjJjYTM0In0.eyJhdWQiOiI4MzJkMmJhZC0xZGJmLTQzMGQtODUzNy0zZTAxNzY1M2I4Y2QiLCJqdGkiOiI4ODc0ZGIzMmVjM2QxMDc4ZDEwZmEwY2MwYTIwMjcwMzM5ZTNiYmViM2IwZTRmODY0ZTFiZWUxOTdmOGY3NWM0ZWZmMTBiMWIxOGIyY2EzNCIsImlhdCI6MTc3NTIzNDM0OCwibmJmIjoxNzc1MjM0MzQ4LCJleHAiOjE4MDM3NzI4MDAsInN1YiI6IjEyNDQzNTYyIiwiZ3JhbnRfdHlwZSI6IiIsImFjY291bnRfaWQiOjI5MTcxNjExLCJiYXNlX2RvbWFpbiI6ImtvbW1vLmNvbSIsInZlcnNpb24iOjIsInNjb3BlcyI6WyJwdXNoX25vdGlmaWNhdGlvbnMiLCJmaWxlcyIsImNybSIsImZpbGVzX2RlbGV0ZSIsIm5vdGlmaWNhdGlvbnMiXSwiaGFzaF91dWlkIjoiMTI0OWE5NWEtNWEyMi00MmUxLTlmMmMtYmQ2MWIxZTFlYjljIiwiYXBpX2RvbWFpbiI6ImFwaS1nLmtvbW1vLmNvbSJ9.muQsmN-fR1AhrlDZjGqvQs65OP7CM0VUO_Wo5MStFPX0Ku5IQvDc__cuxb-le1amqHDr5NYQCwzViJxJyDGsP2RlOFrARL4DPPeDe797ikZSKdHI6gLIfxc7PL-ZdQQJE36G8U2HKu8BX3uOW9Q0s6ahOWfjiQg-8igjvXZVg3wBZxUvyXaagSsvm0T2o_SP2PJ3RLiayAvSfZEdBDr9aq7Kv0yV9BecF69fjVEZU9HcW2VbpTHQT3hJev0QQIBJ7uzj4ZBZsscMK6Qco52kBJt_wSnCRSKTXSyh1UQMe2-m8OcZrdGdMK0qFB8f2eXzgnhmG5TZBaR4QuaiZjRKew',
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

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

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
    
    const dealsResponse = await kommoRequest('GET', '/api/v4/leads?limit=2000&page=1');
    
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

    // Проверяем первые 150 сделок
    const dealsToCheck = leadsList.slice(0, 150);
    console.log(`🔎 Обрабатываем первые ${dealsToCheck.length} сделок`);

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


// Статистика по статусам
app.get('/stats', async (req, res) => {
  try {
    const dealsResponse = await kommoRequest('GET', '/api/v4/leads?limit=2000&page=1');
    let leadsList = [];
    if (dealsResponse._embedded && dealsResponse._embedded.leads) {
      leadsList = dealsResponse._embedded.leads;
    } else if (Array.isArray(dealsResponse)) {
      leadsList = dealsResponse;
    }

    const statsByStatus = {};
    leadsList.forEach(lead => {
      const sid = lead.status_id;
      if (!statsByStatus[sid]) statsByStatus[sid] = 0;
      statsByStatus[sid]++;
      // Пауза 300мс между Claude запросами
      // await sleep(300);
    });

    const stats = Object.entries(statsByStatus)
      .map(([status_id, count]) => ({ status_id: Number(status_id), count }))
      .sort((a, b) => b.count - a.count);

    res.json({
      status: 'success',
      totalDeals: leadsList.length,
      uniqueStatuses: stats.length,
      byStatus: stats,
    });
  } catch (error) {
    res.status(500).json({ status: 'error', error: error.message });
  }
});

app.listen(CONFIG.port, () => {
  console.log(`✅ Kommo Bot запущен на порту ${CONFIG.port}`);
  console.log(`📊 /status`);
  console.log(`🏥 /health`);
  console.log(`📈 /all-deals - ВСЕ СДЕЛКИ`);
});
