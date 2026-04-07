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
          resolve({ error: 'Parse error' });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function analyzeDealWithClaude(dealId, dealName, dealText) {
  const prompt = `Проанализируй сделку и определи статус. Имя: ${dealName} Текст: ${dealText} Возможные статусы: "По почте", "Пора бучить отпечатки", "Wniosek подан по почте", "Отпечатки зарезервированы", "Отпечатки поданы", "Второе вызвание", "Доки поданы", "Позитивная", "Отказ аппеляция", "Отстойники", "Статус не известен". Ответь ТОЛЬКО JSON: {"stage":"название","confidence":0-100,"reason":"причина"}`;

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
    return { stage: 'Статус не известен', confidence: 0, reason: 'Error' };
  }
}

async function extractDealText(deal) {
  try {
    const notes = deal.notes ? deal.notes.map(n => n.params?.text || '').join(' | ') : '';
    const created = deal.created_at ? new Date(deal.created_at * 1000).toLocaleDateString('ru-RU') : '';
    return `${deal.name || ''} | ${notes} | ${created}`.substring(0, 2000);
  } catch (e) {
    return deal.name || '';
  }
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

app.get('/all-deals', async (req, res) => {
  try {
    const deals = await kommoRequest('GET', '/api/v4/leads?limit=1000&page=1');
    let leadsList = deals._embedded?.leads || [];
    if (leadsList.length === 0) return res.json({ status: 'error', message: 'Нет сделок' });

    const byStatus = {};
    leadsList.forEach(lead => {
      const sid = lead.status_id || 'unknown';
      if (!byStatus[sid]) byStatus[sid] = [];
      byStatus[sid].push({ id: lead.id, name: lead.name });
    });

    const summary = Object.entries(byStatus).map(([sid, deals]) => ({
      status_id: sid,
      count: deals.length,
    })).sort((a, b) => b.count - a.count);

    res.json({ status: 'success', totalDeals: leadsList.length, summary });
  } catch (error) {
    res.status(500).json({ status: 'error', error: error.message });
  }
});

app.get('/check-deals', async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  try {
    const deals = await kommoRequest('GET', '/api/v4/leads?limit=2000&page=1');
    let leadsList = deals._embedded?.leads || [];
    if (leadsList.length === 0) return res.json({ status: 'error', message: 'Нет сделок' });

    const recommendations = [];
    const notMoved = [];
    const checkLimit = Math.min(leadsList.length, 150);

    for (let i = 0; i < checkLimit; i++) {
      const deal = leadsList[i];
      const dealText = await extractDealText(deal);
      const analysis = await analyzeDealWithClaude(deal.id, deal.name, dealText);

      if (analysis.confidence >= 70 && analysis.stage !== 'Статус не известен') {
        recommendations.push({
          dealId: deal.id,
          dealName: deal.name,
          currentStatus: deal.status_id,
          newStage: analysis.stage,
          confidence: analysis.confidence,
          reason: analysis.reason,
        });
      } else {
        notMoved.push({
          dealId: deal.id,
          dealName: deal.name,
          currentStatus: deal.status_id,
          confidence: analysis.confidence,
        });
      }
      await new Promise(r => setTimeout(r, 300));
    }

    res.json({
      status: 'success',
      summary: {
        checkedDeals: checkLimit,
        totalDeals: leadsList.length,
        toMove: recommendations.length,
        toKeep: notMoved.length,
      },
      recommendations: recommendations.slice(0, 30),
      notMoved: notMoved.slice(0, 10),
    });
  } catch (error) {
    res.status(500).json({ status: 'error', error: error.message });
  }
});

app.listen(CONFIG.port, () => {
  console.log(`✅ Kommo Bot на порту ${CONFIG.port}`);
  console.log(`📊 /status, /all-deals, /check-deals`);
});
