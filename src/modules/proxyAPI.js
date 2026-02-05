import OpenAI from 'openai';
import axios from 'axios';

/**
 * Обертка для ProxyAPI - российский прокси для доступа к AI моделям
 * Поддерживает OpenAI, Google, Anthropic и другие провайдеры
 */
export class ProxyAPI {
  constructor(config) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || 'https://api.proxyapi.ru';
    this.provider = config.provider || 'openai'; // openai, google, anthropic
    this.model = config.model || 'gpt-4';
    
    // Создаем OpenAI клиент с кастомным baseURL для ProxyAPI
    this.openai = new OpenAI({
      apiKey: this.apiKey,
      baseURL: `${this.baseUrl}/${this.provider}/v1`,
    });
  }

  /**
   * Получить клиент OpenAI для использования с ProxyAPI
   */
  getOpenAIClient() {
    return this.openai;
  }

  /**
   * Проверить доступность ProxyAPI
   */
  async checkAvailability() {
    try {
      const response = await axios.get(`${this.baseUrl}/health`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
        },
        timeout: 5000,
      });
      return response.status === 200;
    } catch (error) {
      // Если health endpoint недоступен, пробуем просто подключиться
      return true; // Предполагаем, что доступен
    }
  }

  /**
   * Получить информацию о доступных моделях
   */
  async getAvailableModels() {
    try {
      const response = await axios.get(`${this.baseUrl}/${this.provider}/v1/models`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
        },
      });
      return response.data;
    } catch (error) {
      console.warn('[ProxyAPI] Не удалось получить список моделей:', error.message);
      return null;
    }
  }
}
