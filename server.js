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

// HTTP запрос к Kommo
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

// Анализ с Claude
async function analyzeDealWithClaude(dealId, dealName, dealText) {
  const prompt = `Проанализируй эту сделку и определи статус.

Имя: ${dealName}
Текст: ${dealText}

Возможные статусы (выбери ТОЛЬКО если уверен > 70%):
- "По почте" - подготовка wniosek
- "Пора бучить отпечатки" - запись на визит
- "Wniosek подан по почте" - wniosek отправлен
- "Отпечатки зарезервированы" - записан на дату
- "Отпечатки поданы" - сдал отпечатки
- "Второе вызвание" - второе wezwanie
- "Доки поданы" - документы отправлены
- "Позитивная" - одобрили
- "Отказ аппеляция" - отказали
- "Отстойники" - пропал
- "Статус не известен" - если неясно

JSON: {"stage":"название","confidence":число0-100,"reason":"причина"}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': CONFIG.claudeKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-opus-4-20250805',
        max_tokens: 300,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const data = await response.json();
    const content = data.content[0]?.text || '{}';
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    return JSON.parse(jsonMatch ? jsonMatch[0] : '{}');
  } catch (error) {
    return { stage: 'Статус не известен', confidence: 0, reason: 'Ошибка' };
  }
}

// Получить текст сделки
async function extractDealText(deal) {
  try {
    const notes = deal.notes ? deal.notes.map(n => n.params?.text || '').join(' | ') : '';
    const created = deal.created_at ? `Создана: ${new Date(deal.created_at * 1000).toLocaleDateString('ru-RU')}` : '';
    return `${deal.name || ''} | ${notes} | ${created}`.substring(0, 2000);
  } catch (e) {
    return deal.name || '';
  }
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
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ГЛАВНЫЙ ENDPOINT - Проверить сделки
app.get('/check-deals', async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  
  try {
    console.log('🔍 Начинаю проверку сделок...');
    
    // Получить сделки из воронки "Статус не известен" (ID: 73793206)
    const dealsResponse = await kommoRequest('GET', '/api/v4/leads?filter[status_id]=73793206&limit=100&page=1');
    const deals = dealsResponse;
    
    if (!deals._embedded || !deals._embedded.leads) {
      return res.json({ status: 'error', message: 'Нет сделок в воронке' });
    }

    const leadsList = deals._embedded.leads;
    console.log(`📊 Найдено ${leadsList.length} сделок`);

    const recommendations = [];
    const notMoved = [];

    // Проверить каждую сделку
    for (let i = 0; i < leadsList.length; i++) {
      const deal = leadsList[i];
      console.log(`⏳ Проверяю ${i + 1}/${leadsList.length}: ${deal.name}`);

      const dealText = await extractDealText(deal);
      const analysis = await analyzeDealWithClaude(deal.id, deal.name, dealText);

      if (analysis.confidence >= 70 && analysis.stage !== 'Статус не известен') {
        console.log(`   ✅ МОЖНО ПЕРЕНОСИТЬ: ${analysis.stage}`);
        recommendations.push({
          dealId: deal.id,
          dealName: deal.name,
          newStage: analysis.stage,
          confidence: analysis.confidence,
          reason: analysis.reason,
        });
      } else {
        console.log(`   ⏸️ Оставить (уверенность: ${analysis.confidence}%)`);
        notMoved.push({
          dealId: deal.id,
          dealName: deal.name,
          reason: analysis.reason,
          confidence: analysis.confidence,
        });
      }

      // Пауза между запросами (не перегружать API)
      await new Promise(r => setTimeout(r, 300));
    }

    console.log(`\n✅ Проверка завершена!`);
    console.log(`📈 К переносу: ${recommendations.length}`);
    console.log(`⏸️ Оставить: ${notMoved.length}`);

    res.json({
      status: 'success',
      message: 'Проверка завершена',
      summary: {
        totalChecked: leadsList.length,
        toMove: recommendations.length,
        toKeep: notMoved.length,
      },
      recommendations: recommendations.slice(0, 50),
      notMoved: notMoved.slice(0, 20),
    });

  } catch (error) {
    console.error('❌ Ошибка:', error.message);
    res.status(500).json({ 
      status: 'error', 
      error: error.message,
      message: 'Ошибка при проверке сделок'
    });
  }
});

// Запуск сервера
app.listen(CONFIG.port, () => {
  console.log(`✅ Kommo Bot запущен на порту ${CONFIG.port}`);
  console.log(`📊 /status - статус`);
  console.log(`🏥 /health - проверка`);
  console.log(`🧪 /test-deals - тест`);
  console.log(`📈 /check-deals - ЗАПУСТИТЬ ПРОВЕРКУ СДЕЛОК`);
});
