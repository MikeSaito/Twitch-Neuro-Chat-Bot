import { LocalLLM } from './localLLM.js';

/**
 * Нейронка для чтения чата
 * Игнорирует большую часть сообщений, но периодически цепляет интересные,
 * на которые можно ответить
 */
export class ChatReader {
  constructor(config = {}) {
    this.config = config;
    this.localLLM = null;
    this.isBusy = false;
    this.brainCoordinator = null; // Мозг может оптимизировать промпты
    
    if (config.useLocal) {
      this.localLLM = new LocalLLM({
        apiUrl: config.localOllamaUrl || 'http://localhost:11434',
        model: config.localOllamaModel || 'llama2',
      });
    }
    
    // История прочитанных сообщений
    this.readHistory = [];
    this.maxHistoryLength = 50;
    
    // Статистика
    this.stats = {
      totalRead: 0,
      interestingFound: 0,
      ignored: 0,
    };
  }

  async init() {
    if (this.localLLM) {
      await this.localLLM.init();
    }
  }

  /**
   * Анализирует сообщения чата и находит интересные
   * @param {Array} chatMessages - массив сообщений из чата
   * @param {Object} context - контекст стрима (изображение, речь и т.д.)
   * @returns {Array} - массив интересных сообщений с анализом
   */
  async findInterestingMessages(chatMessages, context = {}) {
    if (this.isBusy || !chatMessages || chatMessages.length === 0) {
      return [];
    }

    this.isBusy = true;
    this.stats.totalRead += chatMessages.length;

    try {
      // Фильтруем сообщения: убираем уже прочитанные
      const newMessages = chatMessages.filter(msg => {
        const msgId = `${msg.username}_${msg.timestamp || msg.message}`;
        return !this.readHistory.includes(msgId);
      });

      if (newMessages.length === 0) {
        return [];
      }

      // Берем последние 20 сообщений для анализа
      const recentMessages = newMessages.slice(-20);

      // Анализируем через ИИ какие сообщения интересные
      const interestingMessages = await this.analyzeMessages(recentMessages, context);

      // Сохраняем прочитанные сообщения
      recentMessages.forEach(msg => {
        const msgId = `${msg.username}_${msg.timestamp || msg.message}`;
        this.readHistory.push(msgId);
        if (this.readHistory.length > this.maxHistoryLength) {
          this.readHistory.shift();
        }
      });

      if (interestingMessages.length > 0) {
        this.stats.interestingFound += interestingMessages.length;
        console.log(`[ChatReader] 🎯 Найдено интересных сообщений: ${interestingMessages.length}`);
      } else {
        this.stats.ignored += recentMessages.length;
      }

      return interestingMessages;
    } catch (error) {
      console.error('[ChatReader] Ошибка анализа чата:', error);
      return [];
    } finally {
      this.isBusy = false;
    }
  }

  /**
   * Анализ сообщений через ИИ
   */
  async analyzeMessages(messages, context) {
    if (!this.localLLM) {
      // Fallback: простой анализ без ИИ
      return this.simpleAnalysis(messages);
    }

    try {
      const messagesText = messages.map((msg, idx) => 
        `${idx + 1}. ${msg.username}: ${msg.message}`
      ).join('\n');

      const contextInfo = context.imageAnalysis 
        ? `\nКонтекст стрима: ${context.imageAnalysis.description?.substring(0, 200)}...`
        : '';
      
      const speechInfo = context.speechText
        ? `\nРечь: ${context.speechText.text}`
        : '';

      // Базовый промпт - мозг может его полностью оптимизировать
      let prompt = `Ты эксперт по анализу Twitch чата. Твоя задача - найти ТОЛЬКО ДЕЙСТВИТЕЛЬНО ИНТЕРЕСНЫЕ сообщения, на которые стоит ответить.

КРИТЕРИИ ИНТЕРЕСНЫХ СООБЩЕНИЙ (должны быть ВСЕ условия):
1. ВОПРОСЫ:
   - Прямые вопросы к стримеру или чату ("почему?", "как?", "что дальше?")
   - Вопросы о происходящем в стриме
   - Вопросы требующие ответа

2. ИНТЕРЕСНЫЕ КОММЕНТАРИИ:
   - Наблюдения о геймплее/контенте
   - Интересные замечания о событиях
   - Обсуждения стратегии/тактики
   - Комментарии о действиях стримера

3. ШУТКИ/МЕМЫ:
   - Остроумные шутки связанные с происходящим
   - Мемы из чата на которые можно отреагировать
   - Забавные комментарии

4. ОБСУЖДЕНИЯ:
   - Обсуждения игры/контента
   - Споры или дискуссии (если конструктивные)
   - Обмен мнениями

СТРОГО ИГНОРИРУЙ (это НЕ интересно):
- Простые реакции: "красава", "вау", "ого", "круто", "да", "нет"
- Односложные сообщения: "ага", "ок", "понял"
- Спам: повторяющиеся сообщения, копипаста
- Донаты/подписки: "спасибо за подписку", "донат от..."
- Личные разговоры: сообщения между зрителями не связанные со стримом
- Пустые или бессмысленные: только эмодзи, только символы
- Слишком короткие: меньше 10 символов (кроме вопросов)
- Слишком длинные: больше 200 символов (обычно спам)

КОНТЕКСТ СТРИМА:${contextInfo}${speechInfo}

ВАЖНО:
- Учитывай контекст стрима - сообщение должно быть релевантно происходящему
- Если сообщение не связано с контекстом - скорее всего не интересно
- Вопросы ВСЕГДА интересны (если не спам)
- Шутки интересны только если они по делу

СООБЩЕНИЯ ЧАТА:
${messagesText}

ПРОАНАЛИЗИРУЙ каждое сообщение и верни ТОЛЬКО номера ДЕЙСТВИТЕЛЬНО интересных через запятую (например: "3, 7, 12").
Будь СТРОГИМ - лучше пропустить, чем выбрать неинтересное.
Если интересных нет - верни "null".`;

      // Мозг может полностью оптимизировать промпт ChatReader
      if (this.brainCoordinator) {
        prompt = await this.brainCoordinator.optimizeChatReaderPrompt(prompt, {
          messages,
          ...context,
        });
      }

      const result = await this.localLLM.generate(
        prompt,
        `Ты эксперт по анализу Twitch чата. Твоя задача - найти ТОЛЬКО действительно интересные сообщения для ответа.

БУДЬ СТРОГИМ:
- Игнорируй простые реакции ("красава", "вау")
- Игнорируй спам и повторения
- Выбирай только вопросы, интересные комментарии, шутки по делу
- Учитывай контекст стрима

Верни ТОЛЬКО номера интересных сообщений через запятую или "null".`,
        {
          temperature: 0.2, // Снижена для более точного анализа
          max_tokens: 100,
          top_p: 0.9,
        }
      );

      // Извлекаем текст из результата (localLLM.generate возвращает объект с полем text)
      const resultText = typeof result === 'string' ? result : (result?.text || String(result || 'null'));

      // Парсим результат
      const interestingIndices = this.parseIndices(resultText);
      
      if (interestingIndices.length === 0) {
        return [];
      }

      // Возвращаем интересные сообщения с анализом
      return interestingIndices.map(idx => {
        const msg = messages[idx - 1]; // Индексы с 1
        if (!msg) return null;
        
        return {
          message: msg.message,
          username: msg.username,
          timestamp: msg.timestamp || Date.now(),
          index: idx,
          whyInteresting: this.analyzeWhyInteresting(msg, context),
        };
      }).filter(msg => msg !== null);
    } catch (error) {
      console.error('[ChatReader] Ошибка ИИ анализа:', error);
      return this.simpleAnalysis(messages);
    }
  }

  /**
   * Простой анализ без ИИ (fallback)
   */
  simpleAnalysis(messages) {
    const interesting = [];
    
    // Ищем вопросы, упоминания стримера, интересные слова
    const questionWords = ['?', 'почему', 'как', 'что', 'когда', 'где', 'кто'];
    const interestingWords = ['интересно', 'круто', 'вау', 'ого', 'почему', 'как так'];
    
    messages.forEach((msg, idx) => {
      const lowerMsg = msg.message.toLowerCase();
      
      // Проверяем на вопросы
      const hasQuestion = questionWords.some(word => lowerMsg.includes(word));
      
      // Проверяем на интересные слова
      const hasInteresting = interestingWords.some(word => lowerMsg.includes(word));
      
      // Проверяем длину (слишком короткие обычно не интересны)
      const hasLength = msg.message.length > 10 && msg.message.length < 200;
      
      if ((hasQuestion || hasInteresting) && hasLength) {
        interesting.push({
          message: msg.message,
          username: msg.username,
          timestamp: msg.timestamp || Date.now(),
          index: idx + 1,
          whyInteresting: hasQuestion ? 'Вопрос' : 'Интересный комментарий',
        });
      }
    });

    return interesting.slice(0, 3); // Максимум 3 интересных
  }

  /**
   * Парсинг индексов из ответа ИИ
   */
  parseIndices(result) {
    if (!result || typeof result !== 'string') {
      return [];
    }

    const text = result.trim().toLowerCase();
    
    if (text === 'null' || text === 'нет' || text === 'none') {
      return [];
    }

    // Извлекаем числа
    const numbers = text.match(/\d+/g);
    if (!numbers) {
      return [];
    }

    return numbers.map(n => parseInt(n)).filter(n => !isNaN(n) && n > 0);
  }

  /**
   * Анализ почему сообщение интересное
   */
  analyzeWhyInteresting(message, context) {
    const lowerMsg = message.message.toLowerCase();
    
    if (lowerMsg.includes('?')) {
      return 'Содержит вопрос';
    }
    
    if (lowerMsg.includes('почему') || lowerMsg.includes('как')) {
      return 'Интересный вопрос';
    }
    
    if (lowerMsg.includes('интересно') || lowerMsg.includes('круто')) {
      return 'Интересный комментарий';
    }
    
    return 'Потенциально интересное сообщение';
  }

  /**
   * Получить статистику
   */
  getStats() {
    return {
      ...this.stats,
      readHistorySize: this.readHistory.length,
    };
  }

  /**
   * Очистить историю
   */
  clearHistory() {
    this.readHistory = [];
    this.stats = {
      totalRead: 0,
      interestingFound: 0,
      ignored: 0,
    };
  }
}
