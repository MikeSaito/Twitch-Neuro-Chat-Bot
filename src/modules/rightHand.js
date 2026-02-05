import { LocalLLM } from './localLLM.js';

/**
 * Правая рука мозга - помощник для выполнения сложных задач
 * Имеет похожие на мозг возможности и выполняет требования мозга
 */
export class RightHand {
  constructor(config = {}) {
    this.config = config;
    this.localLLM = null;
    this.isBusy = false;
    this.taskQueue = [];
    
    if (config.useLocal) {
      this.localLLM = new LocalLLM({
        apiUrl: config.localOllamaUrl || 'http://localhost:11434',
        model: config.localOllamaModel || 'llama2',
      });
    }
  }

  async init() {
    if (this.localLLM) {
      await this.localLLM.init();
    }
  }

  /**
   * Выполнение сложной задачи от мозга
   * @param {string} task - описание задачи
   * @param {Object} context - контекст для выполнения задачи
   * @param {Object} brainInstructions - инструкции от мозга
   * @returns {Object} - результат выполнения задачи
   */
  async executeTask(task, context = {}, brainInstructions = {}) {
    if (this.isBusy) {
      // Добавляем в очередь
      return new Promise((resolve) => {
        this.taskQueue.push({ task, context, brainInstructions, resolve });
      });
    }

    this.isBusy = true;

    try {
      console.log(`[RightHand] 🤚 Выполняю задачу от мозга: ${task.substring(0, 50)}...`);
      
      const result = await this.processTask(task, context, brainInstructions);
      
      console.log(`[RightHand] ✅ Задача выполнена`);
      return result;
    } catch (error) {
      console.error('[RightHand] ❌ Ошибка выполнения задачи:', error);
      return {
        success: false,
        error: error.message,
        result: null,
      };
    } finally {
      this.isBusy = false;
      
      // Обрабатываем следующую задачу из очереди
      if (this.taskQueue.length > 0) {
        const nextTask = this.taskQueue.shift();
        this.executeTask(nextTask.task, nextTask.context, nextTask.brainInstructions)
          .then(nextTask.resolve)
          .catch(() => nextTask.resolve({ success: false, error: 'Ошибка очереди', result: null }));
      }
    }
  }

  /**
   * Обработка задачи
   */
  async processTask(task, context, brainInstructions) {
    if (!this.localLLM) {
      return {
        success: false,
        error: 'Локальный LLM не доступен',
        result: null,
      };
    }

    try {
      const contextInfo = this.buildContextInfo(context);
      const instructions = brainInstructions.instructions || '';
      const expectedFormat = brainInstructions.expectedFormat || 'text';

      // Если задача связана с генерацией сообщений - используем специальный промпт
      if (task.includes('промпт') && task.includes('сообщени')) {
        const prompt = `Ты редактируешь промпт для генерации сообщений в Twitch чат.

ЗАДАЧА: ${task}

БАЗОВЫЙ ПРОМПТ:
${context.basePrompt || ''}

ИНСТРУКЦИИ:
${instructions || 'Улучши промпт, сохранив все важные инструкции. Сделай его более эффективным.'}

КРИТИЧЕСКИ ВАЖНО:
- Промпт должен требовать генерацию сообщений ТОЛЬКО на русском языке
- Промпт должен требовать писать как обычный зритель, НЕ как ИИ
- Промпт должен запрещать мета-комментарии и объяснения
- Промпт должен требовать возвращать ТОЛЬКО готовое сообщение

Верни ТОЛЬКО улучшенный промпт, без дополнительных объяснений.`;
        
        const llmResult = await this.localLLM.generate(
          prompt,
          'Ты эксперт по промптам. Улучшаешь промпты для генерации сообщений.',
          {
            temperature: 0.3,
            max_tokens: 1000,
          }
        );
        
        const result = typeof llmResult === 'string' ? llmResult : (llmResult?.text || String(llmResult || ''));
        
        return {
          success: true,
          result: result,
          format: 'prompt',
          timestamp: Date.now(),
        };
      }
      
      // Для других задач - обычный промпт
      const prompt = `Ты правая рука мозга - помощник для выполнения сложных задач.

ЗАДАЧА ОТ МОЗГА:
${task}

ИНСТРУКЦИИ ОТ МОЗГА:
${instructions || 'Выполни задачу качественно и детально.'}

КОНТЕКСТ:
${contextInfo}

ТВОЯ РОЛЬ:
- Ты выполняешь сложные задачи, которые мозг не может решить сам
- Ты более детально анализируешь информацию
- Ты можешь создавать развернутые ответы
- Ты помогаешь мозгу принимать решения

ВАЖНО:
- Будь точным и детальным
- Учитывай все нюансы контекста
- Если задача неясна - уточни что именно нужно сделать
- Если задача связана с генерацией сообщений - верни ТОЛЬКО готовое сообщение на русском, БЕЗ мета-комментариев

Верни результат выполнения задачи.`;

      const llmResult = await this.localLLM.generate(
        prompt,
        'Ты правая рука мозга - помощник для сложных задач.',
        {
          temperature: 0.7,
          max_tokens: 500,
        }
      );

      // Извлекаем текст из результата (localLLM.generate возвращает объект с полем text)
      const result = typeof llmResult === 'string' ? llmResult : (llmResult?.text || String(llmResult || ''));

      return {
        success: true,
        result: result,
        format: expectedFormat,
        timestamp: Date.now(),
      };
    } catch (error) {
      console.error('[RightHand] Ошибка обработки задачи:', error);
      return {
        success: false,
        error: error.message,
        result: null,
      };
    }
  }

  /**
   * Построение информации о контексте
   */
  buildContextInfo(context) {
    let info = '';

    if (context.imageAnalysis) {
      info += `\nАнализ изображения: ${context.imageAnalysis.description?.substring(0, 300)}...`;
    }

    if (context.speechText) {
      info += `\nРечь: ${context.speechText.text}`;
    }

    if (context.chatHistory) {
      const recentChat = context.chatHistory.slice(-5).map(m => `${m.username}: ${m.message}`).join('\n');
      info += `\nПоследние сообщения чата:\n${recentChat}`;
    }

    if (context.interestingMessages) {
      const interesting = context.interestingMessages.map(m => `${m.username}: ${m.message}`).join('\n');
      info += `\nИнтересные сообщения:\n${interesting}`;
    }

    if (context.time) {
      info += `\nВремя: ${new Date(context.time).toLocaleString('ru-RU')}`;
    }

    if (context.streamContext) {
      info += `\nКонтекст стрима: ${JSON.stringify(context.streamContext, null, 2)}`;
    }

    return info || 'Контекст не предоставлен';
  }

  /**
   * Редактирование промпта по запросу мозга
   */
  async editPrompt(basePrompt, task, context) {
    return await this.executeTask(
      `Отредактируй и оптимизируй следующий промпт для задачи: ${task}`,
      { basePrompt, ...context },
      {
        instructions: 'Улучши промпт, сохранив все важные инструкции. Сделай его более эффективным.',
        expectedFormat: 'prompt',
      }
    );
  }

  /**
   * Глубокий анализ контекста
   */
  async deepAnalysis(context) {
    return await this.executeTask(
      'Проведи глубокий анализ предоставленного контекста стрима',
      context,
      {
        instructions: 'Найди все важные детали, связи между событиями, эмоциональный контекст.',
        expectedFormat: 'analysis',
      }
    );
  }
}
