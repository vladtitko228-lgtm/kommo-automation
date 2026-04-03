const https = require('https');

const CONFIG = {
  kommoSubdomain: 'supremes',
  kommoToken: 'XAknRcVtkLAYfCYulqEgdX23ktj6npheHQ15UQWi0v4jnvsw6pr5hD9oUfEJJMqk',
  pipelineId: 3840844,
  statusId: 142897939, // "Статус не известен"
  claudeKey: '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',
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

// Получить текст сделки
async function extractDealText(deal) {
  try {
    const notes = deal.notes ? deal.notes.map(n => n.params?.text || '').join(' | ') : '';
    const responsible = deal.responsible_user_id ? `Ответственный: ${deal.responsible_user_id}` : '';
    const created = deal.created_at ? `Создана: ${new Date(deal.created_at * 1000).toLocaleDateString('ru-RU')}` : '';
    
    return `${deal.name || ''} | ${notes} | ${responsible} | ${created}`.substring(0, 2000);
  } catch (e) {
    return deal.name || '';
  }
}

// Анализ с Claude
async function analyzeDealWithClaude(dealId, dealName, dealText) {
  const prompt = `Проанализируй эту сделку клиента и определи реальный статус процесса.

Имя: ${dealName}
Текст: ${dealText}

Возможные статусы (выбери ТОЛЬКО если очень уверен, иначе "Статус не известен"):
- "По почте" - подготовка документов для wniosek
- "Пора бучить отпечатки" - клиент готов записаться
- "Wniosek подан по почте" - wniosek отправлен
- "Отпечатки зарезервированы" - записан на конкретную дату
- "Отпечатки поданы" - сдал отпечатки
- "Второе вызвание" - получено второе wezwanie
- "Доки поданы" - отправлены документы
- "Позитивная" - одобрили
- "Отказ аппеляция" - отказали
- "Отстойники" - пропал, не отвечает
- "Статус не известен" - если не ясно

Ответь ТОЛЬКО в JSON формате:
{"stage":"название","confidence":число0-100,"reason":"объяснение"}`;

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
    const result = JSON.parse(jsonMatch ? jsonMatch[0] : '{}');
    
    return result || { stage: 'Статус не известен', confidence: 0, reason: 'Ошибка' };
  } catch (error) {
    console.error('Claude ошибка:', error.message);
    return { stage: 'Статус не известен', confidence: 0, reason: 'Ошибка API' };
  }
}

// Главная функция
async function checkDeals() {
  console.log('🔍 Начинаю проверку сделок из "Статус не известен"...\n');

  try {
    // Получить все сделки из воронки
    const deals = await kommoRequest('GET', `/api/v4/leads?filter[status_id]=${CONFIG.statusId}&limit=100`);
    
    if (!deals._embedded || !deals._embedded.leads) {
      console.log('❌ Нет сделок в воронке');
      return;
    }

    const leadsList = deals._embedded.leads;
    console.log(`📊 Найдено ${leadsList.length} сделок\n`);

    const recommendations = [];
    const notMoved = [];

    // Проверить каждую сделку
    for (let i = 0; i < leadsList.length; i++) {
      const deal = leadsList[i];
      process.stdout.write(`⏳ Проверяю сделку ${i + 1}/${leadsList.length}: ${deal.name || 'Без имени'}...`);

      const dealText = await extractDealText(deal);
      const analysis = await analyzeDealWithClaude(deal.id, deal.name, dealText);

      // Если confidence > 70% И это не "Статус не известен"
      if (analysis.confidence >= 70 && analysis.stage !== 'Статус не известен') {
        console.log(` ✅ МОЖНО ПЕРЕНОСИТЬ!\n`);
        recommendations.push({
          dealId: deal.id,
          dealName: deal.name,
          currentStage: 'Статус не известен',
          newStage: analysis.stage,
          confidence: analysis.confidence + '%',
          reason: analysis.reason,
        });
      } else {
        console.log(` ⏸️ Оставить\n`);
        notMoved.push({
          dealId: deal.id,
          dealName: deal.name,
          reason: analysis.reason,
          confidence: analysis.confidence + '%',
        });
      }

      // Пауза между запросами (не перегружать API)
      await new Promise(r => setTimeout(r, 500));
    }

    // Вывести результаты
    console.log('\n' + '='.repeat(80));
    console.log('📈 РЕЗУЛЬТАТЫ ПРОВЕРКИ');
    console.log('='.repeat(80) + '\n');

    if (recommendations.length > 0) {
      console.log(`✅ РЕКОМЕНДАЦИИ ДЛЯ ПЕРЕНОСА (${recommendations.length} сделок):\n`);
      recommendations.forEach((rec, idx) => {
        console.log(`${idx + 1}. ${rec.dealName} (ID: ${rec.dealId})`);
        console.log(`   Переносить в: ${rec.newStage}`);
        console.log(`   Уверенность: ${rec.confidence}`);
        console.log(`   Причина: ${rec.reason}\n`);
      });
    } else {
      console.log('❌ Нет сделок для переноса (низкая уверенность)\n');
    }

    if (notMoved.length > 0) {
      console.log(`⏸️ ОСТАВИТЬ В ТЕКУЩЕЙ ВОРОНКЕ (${notMoved.length} сделок):\n`);
      notMoved.slice(0, 10).forEach((item, idx) => {
        console.log(`${idx + 1}. ${item.dealName} (ID: ${item.dealId})`);
        console.log(`   Причина: ${item.reason} (уверенность: ${item.confidence})\n`);
      });
      if (notMoved.length > 10) {
        console.log(`... и ещё ${notMoved.length - 10} сделок\n`);
      }
    }

    console.log('='.repeat(80));
    console.log(`\n📊 ИТОГО:`);
    console.log(`✅ К переносу: ${recommendations.length}`);
    console.log(`⏸️ Оставить: ${notMoved.length}`);
    console.log(`📈 Всего проверено: ${leadsList.length}`);

  } catch (error) {
    console.error('❌ Ошибка:', error.message);
  }
}

// Запустить
checkDeals();
