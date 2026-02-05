import { LocalLLM } from './localLLM.js';

/**
 * ИИ-помощник мозга для решения сложных задач
 * Используется когда основная ИИ не справляется или задача слишком сложная
 */
export class BrainAssistant {
  constructor(config = {}) {
    this.config = config;
    this.localLLM = null;
    
    if (config.useLocal) {
      this.localLLM = new LocalLLM({
        apiUrl: config.localOllamaUrl || 'http://localhost:11434',
        model: config.localOllamaModel || 'llama2',
      });
    }
    
    this.isBusy = false;
    this.taskQueue = [];
  }

  async init() {
    if (this.localLLM) {
      await this.localLLM.init();
    }
  }

  /**
   * Решение сложной задачи генерации сообщения
   */
  async solveComplexMessageTask(context, basePrompt) {
    if (this.isBusy) {
      // Если занят, добавляем в очередь
      return new Promise((resolve) => {
        this.taskQueue.push({ context, basePrompt, resolve });
      });
    }

    this.isBusy = true;

    try {
      // Используем базовый промпт полностью, добавляя только контекст
      // Оптимизированный промпт для скорости
      const imageContext = context.imageAnalysis?.description ? `\nВИЗУАЛЬНО: ${context.imageAnalysis.description.substring(0, 200)}` : '';
      const speechContext = context.speechText?.text ? `\nРЕЧЬ: ${context.speechText.text.substring(0, 150)}` : '';
      const chatContext = context.chatHistory?.length > 0 ? `\nЧАТ: ${context.chatHistory.slice(-3).map(m => `${m.username}: ${m.message}`).join('; ')}` : '';
      
      const assistantPrompt = `${basePrompt}${imageContext}${speechContext}${chatContext}

КРИТИЧЕСКИ ВАЖНО:
1. Ты РЕАЛЬНЫЙ ЧЕЛОВЕК, НЕ бот, НЕ ИИ - имитируй ОБЫЧНОГО ЗРИТЕЛЯ ТОЧЬ В ТОЧЬ
2. Мат/пошлости/хамство БЕЗ ОГРАНИЧЕНИЙ (кроме банвордов Twitch и политики)
3. Ты НЕ объясняешь, НЕ комментируешь - только сообщение
4. ТОЛЬКО русский язык, ТОЛЬКО готовое сообщение, БЕЗ кавычек, БЕЗ предисловий
5. Если нечего сказать - верни "null"`;

      const result = await this.localLLM.generate(
        assistantPrompt,
        'Ты обычный зритель Twitch стрима. Пишешь сообщения в чат на русском языке как обычный человек.',
        {
          temperature: 0.8,
          max_tokens: 150,
        }
      );

      // localLLM.generate возвращает объект с полем text
      let resultText = (result && typeof result === 'object' ? result.text : result) || null;
      
      // Очищаем результат от мета-комментариев и проверяем язык
      if (resultText) {
        resultText = this.cleanMessage(resultText);
      }
      
      return resultText;
    } catch (error) {
      console.error('[BrainAssistant] Ошибка решения задачи:', error);
      return null;
    } finally {
      this.isBusy = false;
      
      // Обрабатываем следующую задачу из очереди
      if (this.taskQueue.length > 0) {
        const nextTask = this.taskQueue.shift();
        this.solveComplexMessageTask(nextTask.context, nextTask.basePrompt)
          .then(nextTask.resolve)
          .catch(() => nextTask.resolve(null));
      }
    }
  }

  /**
   * Очистка сообщения от мета-комментариев и проверка языка
   */
  cleanMessage(text) {
    if (!text || typeof text !== 'string') return null;
    
    let cleaned = text.trim();
    
    // Удаляем мета-комментарии в начале
    const metaPatterns = [
      /^.*?(?:спасибо за задание|я могу создать|я могу|как.*?помощник|as.*?assistant|as.*?ai|i'm here to help|i can|here's|вот|давайте попробуем)/i,
      /^.*?(?:message:|сообщение:|результат:|result:)/i,
      /^["'«»]/, // Удаляем кавычки в начале
      /["'«»]$/, // Удаляем кавычки в конце
    ];
    
    for (const pattern of metaPatterns) {
      cleaned = cleaned.replace(pattern, '').trim();
    }
    
    // Если сообщение начинается с кавычек - извлекаем содержимое
    const quotedMatch = cleaned.match(/^["'«»](.+?)["'«»]$/);
    if (quotedMatch) {
      cleaned = quotedMatch[1].trim();
    }
    
    // Проверяем язык - если больше английских слов чем русских, отбрасываем
    const russianChars = (cleaned.match(/[а-яё]/gi) || []).length;
    const englishChars = (cleaned.match(/[a-z]/gi) || []).length;
    
    // Если английских символов больше чем русских - отбрасываем
    if (englishChars > russianChars && russianChars < 5) {
      console.log('[BrainAssistant] ⚠️ Сообщение на английском языке, отбрасываем');
      return null;
    }
    
    // Если сообщение слишком длинное (больше 300 символов) - обрезаем
    if (cleaned.length > 300) {
      cleaned = cleaned.substring(0, 297) + '...';
    }
    
    // Если сообщение слишком короткое или пустое - отбрасываем
    if (cleaned.length < 3) {
      return null;
    }
    
    return cleaned;
  }

  /**
   * Анализ сложного изображения
   */
  async analyzeComplexImage(imageBuffer, basePrompt, context) {
    if (this.isBusy) {
      return null; // Пропускаем если занят
    }

    this.isBusy = true;

    try {
      const assistantPrompt = `Ты ИИ-помощник для глубокого анализа изображений Twitch стрима.

БАЗОВЫЙ ПРОМПТ:
${basePrompt}

КОНТЕКСТ:
${JSON.stringify(context, null, 2)}

ТВОЯ РОЛЬ:
- Проводи более глубокий анализ чем основная ИИ
- Замечай детали которые могли быть пропущены
- Учитывай контекст стрима и чата
- Структурируй анализ максимально подробно

Верни детальное описание изображения.`;

      const result = await this.localLLM.analyzeImage(
        imageBuffer,
        assistantPrompt
      );

      return result;
    } catch (error) {
      console.error('[BrainAssistant] Ошибка анализа изображения:', error);
      return null;
    } finally {
      this.isBusy = false;
    }
  }
}
