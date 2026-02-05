import axios from 'axios';

/**
 * Локальный LLM через Ollama или другой API
 * Поддерживает различные модели: llama2, mistral, codellama и т.д.
 */
export class LocalLLM {
  constructor(config = {}) {
    this.apiUrl = config.apiUrl || 'http://localhost:11434'; // Ollama по умолчанию
    this.model = config.model || 'llama2'; // Модель по умолчанию
    this.provider = config.provider || 'ollama'; // ollama, lmstudio, или другой
    this.timeout = config.timeout || 300000; // 300 секунд (5 минут) для локальных моделей - они работают медленнее
  }

  async init() {
    try {
      // Проверяем доступность локального API
      if (this.provider === 'ollama') {
        const response = await axios.get(`${this.apiUrl}/api/tags`, { timeout: 5000 });
        console.log(`[LocalLLM] Ollama подключен. Доступные модели: ${response.data.models?.map(m => m.name).join(', ') || 'нет'}`);
        return true;
      }
      return true;
    } catch (error) {
      console.warn(`[LocalLLM] Локальный API недоступен (${this.apiUrl}). Убедитесь, что Ollama запущен.`);
      return false;
    }
  }

  async generate(prompt, systemPrompt = null, options = {}) {
    try {
      // Убеждаемся, что prompt - строка
      const promptText = typeof prompt === 'string' ? prompt : (prompt?.text || String(prompt || ''));
      
      // Убеждаемся, что systemPrompt - строка
      const systemPromptText = systemPrompt && typeof systemPrompt === 'string' ? systemPrompt : (systemPrompt?.text || String(systemPrompt || '') || null);
      
      if (this.provider === 'ollama') {
        return await this.generateWithOllama(promptText, systemPromptText, options);
      } else if (this.provider === 'lmstudio') {
        return await this.generateWithLMStudio(promptText, systemPromptText, options);
      } else {
        throw new Error(`Неизвестный провайдер: ${this.provider}`);
      }
    } catch (error) {
      console.error('[LocalLLM] Ошибка генерации:', error);
      throw error;
    }
  }

  async generateWithOllama(prompt, systemPrompt, options) {
    const messages = [];
    
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    
    messages.push({ role: 'user', content: prompt });

    try {
      const response = await axios.post(
        `${this.apiUrl}/api/chat`,
        {
          model: this.model,
          messages: messages,
          stream: false,
          options: {
            temperature: options.temperature || 0.8,
            top_p: options.top_p || 0.95,
            num_predict: options.max_tokens || 120, // Оптимизация: меньше токенов = быстрее
            ...options,
          },
        },
        { timeout: this.timeout }
      );

      return {
        text: response.data.message?.content || '',
        model: response.data.model || this.model,
        usage: response.data.usage || {},
      };
    } catch (error) {
      if (error.code === 'ECONNREFUSED' || error.code === 'ECONNRESET') {
        console.error(`[LocalLLM] ❌ Ollama не запущен или недоступен на ${this.apiUrl}`);
        console.error(`[LocalLLM] 💡 Решение:`);
        console.error(`[LocalLLM]    1. Убедитесь, что Ollama установлен и запущен`);
        console.error(`[LocalLLM]    2. Проверьте, что Ollama слушает на порту 11434`);
        console.error(`[LocalLLM]    3. Запустите Ollama: ollama serve`);
        console.error(`[LocalLLM]    4. Или используйте ProxyAPI, установив USE_PROXYAPI=true в .env`);
        throw new Error(`Ollama недоступен: убедитесь, что Ollama запущен на ${this.apiUrl}`);
      }
      if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
        console.warn(`[LocalLLM] Таймаут запроса к Ollama (${this.timeout}ms). Модель работает медленно.`);
        console.warn(`[LocalLLM] Рекомендация: используйте более легкую модель или ProxyAPI для ускорения.`);
        throw new Error(`Таймаут генерации: модель ${this.model} не успела обработать запрос за ${this.timeout}ms`);
      }
      throw error;
    }
  }

  async generateWithLMStudio(prompt, systemPrompt, options) {
    // LM Studio использует OpenAI-совместимый API
    const messages = [];
    
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    
    messages.push({ role: 'user', content: prompt });

    try {
      const response = await axios.post(
        `${this.apiUrl}/v1/chat/completions`,
        {
          model: this.model,
          messages: messages,
          temperature: options.temperature || 0.8,
          max_tokens: options.max_tokens || 500,
        },
        { timeout: this.timeout }
      );

      return {
        text: response.data.choices[0]?.message?.content || '',
        model: response.data.model || this.model,
        usage: response.data.usage || {},
      };
    } catch (error) {
      if (error.code === 'ECONNREFUSED' || error.code === 'ECONNRESET') {
        console.error(`[LocalLLM] ❌ LM Studio не запущен или недоступен на ${this.apiUrl}`);
        console.error(`[LocalLLM] 💡 Решение: убедитесь, что LM Studio запущен и API включен`);
        throw new Error(`LM Studio недоступен: убедитесь, что LM Studio запущен на ${this.apiUrl}`);
      }
      if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
        console.warn(`[LocalLLM] Таймаут запроса к LM Studio (${this.timeout}ms).`);
        throw new Error(`Таймаут генерации: модель не успела обработать запрос за ${this.timeout}ms`);
      }
      throw error;
    }
  }

  async analyzeImage(imageBuffer, prompt) {
    // Для анализа изображений нужна модель с vision (например, LLaVA через Ollama)
    try {
      const base64Image = imageBuffer.toString('base64');
      
      if (this.provider === 'ollama') {
        // Ollama с LLaVA моделью
        const response = await axios.post(
          `${this.apiUrl}/api/generate`,
          {
            model: this.model, // Должна быть vision модель типа llava
            prompt: prompt,
            images: [base64Image],
            stream: false,
            options: {
              num_predict: 500, // Еще меньше для избежания зацикливания
              temperature: 0.1, // Очень низкая температура для максимальной стабильности
              repeat_penalty: 2.0, // Сильный штраф за повторения (предотвращает зацикливание)
              repeat_last_n: 128, // Проверяем больше токенов на повторения
              top_p: 0.8, // Еще уже выбор токенов
              top_k: 20, // Еще уже выбор токенов
              penalty_prompt: 0.1, // Штраф за повторение промпта
            },
          },
          { timeout: this.timeout * 2 } // Vision модели работают дольше
        );

        return {
          text: response.data.response || '',
          model: response.data.model || this.model,
        };
      }
    } catch (error) {
      if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
        console.warn(`[LocalLLM] Таймаут анализа изображения. Модель ${this.model} работает медленно.`);
        throw new Error(`Таймаут анализа изображения: модель не успела обработать за ${this.timeout * 2}ms`);
      }
      console.error('[LocalLLM] Ошибка анализа изображения:', error);
      throw error;
    }
  }
}
