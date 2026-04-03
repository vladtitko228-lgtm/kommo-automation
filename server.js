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

// Простой HTTP запрос
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
          resolve({ error: 'Parse error', raw: data });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Status
app.get('/status', (req, res) => {
  res.json({
    status: 'running',
    kommo: 'connected',
    claude: 'ready',
    message: 'Kommo CRM Bot is working!',
  });
});

// Тест - получить первую сделку
app.get('/test-deals', async (req, res) => {
  try {
    const deals = await kommoRequest('GET', '/api/v4/leads?limit=5');
    res.json({
      status: 'success',
      deals_count: deals._embedded?.leads?.length || 0,
      data: deals,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Запуск сервера
app.listen(CONFIG.port, () => {
  console.log(`✅ Kommo Bot запущен на порту ${CONFIG.port}`);
  console.log(`📊 Status: http://localhost:${CONFIG.port}/status`);
  console.log(`🏥 Health: http://localhost:${CONFIG.port}/health`);
  console.log(`🧪 Test: http://localhost:${CONFIG.port}/test-deals`);
});
