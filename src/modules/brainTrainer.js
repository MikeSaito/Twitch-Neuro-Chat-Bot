import { LocalLLM } from './localLLM.js';
import { PromptManager } from './promptManager.js';

/**
 * Модуль обучения мозга
 * В режиме обучения мозг напрямую получает сообщения из чата
 * и обучается формировать промпты для выделения интересных сообщений и написания сообщений
 */
export class BrainTrainer {
  constructor(config = {}) {
    this.config = config;
    this.localLLM = null;
    this.promptManager = null;
    
    if (config.useLocal) {
      this.localLLM = new LocalLLM({
        apiUrl: config.localOllamaUrl || 'http://localhost:11434',
        model: config.localOllamaModel || 'llama2',
      });
    }
    
    this.promptManager = new PromptManager();
    
    // Данные для обучения
    this.trainingData = {
      chatMessages: [], // Сообщения из чата
      interestingMessages: [], // Помеченные как интересные
      generatedMessages: [], // Сгенерированные сообщения
      contextHistory: [], // История контекста
    };
    
    // Статистика обучения
    this.stats = {
      messagesAnalyzed: 0,
      promptsCreated: 0,
      lastTrainingTime: 0,
    };
  }

  async init() {
    if (this.localLLM) {
      await this.localLLM.init();
    }
    
    if (this.promptManager) {
      await this.promptManager.init();
    }
    
    console.log('[BrainTrainer] 🎓 Модуль обучения инициализирован');
  }

  /**
   * Обработка сообщения из чата в режиме обучения
   */
  async processChatMessage(message, context = {}) {
    this.trainingData.chatMessages.push({
      message,
      context,
      timestamp: Date.now(),
    });

    // Ограничиваем размер истории
    if (this.trainingData.chatMessages.length > 1000) {
      this.trainingData.chatMessages.shift();
    }

    this.stats.messagesAnalyzed++;

    // Периодически анализируем и создаем промпты
    if (this.trainingData.chatMessages.length % 50 === 0) {
      await this.analyzeAndCreatePrompts();
    }
  }

  /**
   * Анализ данных и создание промптов
   */
  async analyzeAndCreatePrompts() {
    if (!this.localLLM || this.trainingData.chatMessages.length < 20) {
      return;
    }

    try {
      console.log('[BrainTrainer] 🎓 Анализ данных для создания промптов...');

      // Анализируем последние сообщения
      const recentMessages = this.trainingData.chatMessages.slice(-100);
      
      // Создаем промпт для ChatReader на основе анализа
      const chatReaderPrompt = await this.createChatReaderPrompt(recentMessages);
      
      // Создаем промпт для генерации сообщений на основе анализа
      const messagePrompt = await this.createMessagePrompt(recentMessages);

      // Сохраняем промпты
      if (chatReaderPrompt && this.promptManager) {
        await this.promptManager.saveChatReaderPrompt(chatReaderPrompt, {
          trainingData: recentMessages.length,
          timestamp: Date.now(),
        });
      }

      if (messagePrompt && this.promptManager) {
        await this.promptManager.saveMessagePrompt(messagePrompt, {
          trainingData: recentMessages.length,
          timestamp: Date.now(),
        });
      }

      this.stats.promptsCreated += 2;
      this.stats.lastTrainingTime = Date.now();
      
      console.log('[BrainTrainer] ✅ Промпты созданы и сохранены');
    } catch (error) {
      console.error('[BrainTrainer] Ошибка создания промптов:', error);
    }
  }

  /**
   * Создание промпта для ChatReader на основе обучения
   */
  async createChatReaderPrompt(messages) {
    if (!this.localLLM) {
      return null;
    }

    try {
      // Анализируем паттерны интересных сообщений
      const messagesText = messages.map((m, idx) => 
        `${idx + 1}. ${m.message.username || 'user'}: ${m.message.message || m.message}`
      ).join('\n');

      const prompt = `Ты мозг в режиме обучения. Проанализируй сообщения из Twitch чата и создай промпт для нейронки, которая будет находить интересные сообщения.

СООБЩЕНИЯ ДЛЯ АНАЛИЗА:
${messagesText}

ТВОЯ ЗАДАЧА:
1. Проанализируй какие сообщения действительно интересные (вопросы, обсуждения, шутки)
2. Определи паттерны интересных сообщений
3. Создай промпт для нейронки ChatReader, которая будет находить такие сообщения

ПРОМПТ должен:
- Описывать критерии интересных сообщений
- Указывать что игнорировать
- Быть конкретным и практичным
- Учитывать контекст Twitch стрима

Верни ТОЛЬКО готовый промпт, без дополнительных объяснений.`;

      const result = await this.localLLM.generate(
        prompt,
        'Ты мозг в режиме обучения. Создай промпт для ChatReader на основе анализа сообщений.',
        {
          temperature: 0.5,
          max_tokens: 1500,
        }
      );

      return result || null;
    } catch (error) {
      console.error('[BrainTrainer] Ошибка создания промпта ChatReader:', error);
      return null;
    }
  }

  /**
   * Создание промпта для генерации сообщений на основе обучения
   */
  async createMessagePrompt(messages) {
    if (!this.localLLM) {
      return null;
    }

    try {
      // Анализируем стиль сообщений
      const messagesText = messages.map((m, idx) => 
        `${idx + 1}. ${m.message.username || 'user'}: ${m.message.message || m.message}`
      ).join('\n');

      const prompt = `Ты мозг в режиме обучения. Проанализируй сообщения из Twitch чата и создай промпт для нейронки, которая будет генерировать сообщения в стиле этого чата.

СООБЩЕНИЯ ДЛЯ АНАЛИЗА:
${messagesText}

ТВОЯ ЗАДАЧА:
1. Проанализируй стиль общения в чате (длина, сленг, эмоции, шутки)
2. Определи паттерны хороших сообщений
3. Создай промпт для нейронки генерации сообщений, которая будет писать в таком же стиле

ПРОМПТ должен:
- Описывать стиль общения (коротко/длинно, формально/неформально, с матом/без)
- Указывать примеры хороших сообщений
- Устанавливать правила длины и формата
- Учитывать контекст Twitch стрима
- НЕ трогать секции про банворды, политику и запрещенные темы

Верни ТОЛЬКО готовый промпт, без дополнительных объяснений.`;

      const result = await this.localLLM.generate(
        prompt,
        'Ты мозг в режиме обучения. Создай промпт для генерации сообщений на основе анализа чата.',
        {
          temperature: 0.5,
          max_tokens: 2000,
        }
      );

      return result || null;
    } catch (error) {
      console.error('[BrainTrainer] Ошибка создания промпта генерации:', error);
      return null;
    }
  }

  /**
   * Получить статистику обучения
   */
  getStats() {
    return {
      ...this.stats,
      messagesInMemory: this.trainingData.chatMessages.length,
      interestingMessages: this.trainingData.interestingMessages.length,
    };
  }

  /**
   * Очистить данные обучения
   */
  clearTrainingData() {
    this.trainingData = {
      chatMessages: [],
      interestingMessages: [],
      generatedMessages: [],
      contextHistory: [],
    };
    this.stats = {
      messagesAnalyzed: 0,
      promptsCreated: 0,
      lastTrainingTime: 0,
    };
    console.log('[BrainTrainer] 🗑️ Данные обучения очищены');
  }
}
