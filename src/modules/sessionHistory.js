import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * История сессии - сохраняет события стрима для контекста
 * Помогает боту помнить предыдущие события даже после перезапуска
 */
export class SessionHistory {
  constructor(config = {}) {
    this.dataDir = path.join(__dirname, '../../data');
    this.historyFile = path.join(this.dataDir, 'session_history.json');
    
    // История событий
    this.history = {
      streamerSpeech: [], // Речь стримера (последние N фрагментов)
      streamEvents: [], // События на стриме (важные моменты)
      botMessages: [], // Отправленные сообщения бота
      metadata: {
        sessionStart: Date.now(),
        lastUpdated: Date.now(),
        totalEvents: 0,
      },
    };
    
    // Ограничения для размера истории
    this.maxSpeechEntries = config.maxSpeechEntries || 50; // Последние 50 фрагментов речи
    this.maxEventEntries = config.maxEventEntries || 30; // Последние 30 событий
    this.maxMessageEntries = config.maxMessageEntries || 20; // Последние 20 сообщений
    
    this.initialized = false;
  }

  /**
   * Инициализация - загрузка истории из файла
   */
  async init() {
    try {
      // Создаем директорию если её нет
      await fs.mkdir(this.dataDir, { recursive: true });
      
      // Пытаемся загрузить существующую историю
      try {
        const data = await fs.readFile(this.historyFile, 'utf-8');
        const loaded = JSON.parse(data);
        
        // Восстанавливаем историю
        this.history = {
          streamerSpeech: loaded.streamerSpeech || [],
          streamEvents: loaded.streamEvents || [],
          botMessages: loaded.botMessages || [],
          metadata: {
            ...loaded.metadata,
            sessionStart: loaded.metadata?.sessionStart || Date.now(),
            lastUpdated: Date.now(),
          },
        };
        
        // Ограничиваем размер истории
        this.trimHistory();
        
        console.log(`[SessionHistory] ✅ Загружена история: ${this.history.streamerSpeech.length} речи, ${this.history.streamEvents.length} событий, ${this.history.botMessages.length} сообщений`);
      } catch (error) {
        // Файл не существует - создаем новую историю
        this.history.metadata.sessionStart = Date.now();
        await this.save();
        console.log('[SessionHistory] ✅ Создана новая история сессии');
      }
      
      this.initialized = true;
    } catch (error) {
      console.error('[SessionHistory] Ошибка инициализации:', error);
      throw error;
    }
  }

  /**
   * Сохранение истории в файл
   */
  async save() {
    try {
      // Убеждаемся, что директория создана
      await fs.mkdir(this.dataDir, { recursive: true });
      
      this.history.metadata.lastUpdated = Date.now();
      this.history.metadata.totalEvents = 
        this.history.streamerSpeech.length + 
        this.history.streamEvents.length + 
        this.history.botMessages.length;
      
      await fs.writeFile(
        this.historyFile,
        JSON.stringify(this.history, null, 2),
        'utf-8'
      );
    } catch (error) {
      console.error('[SessionHistory] Ошибка сохранения истории:', error);
    }
  }

  /**
   * Добавление речи стримера
   */
  async addStreamerSpeech(text, timestamp = Date.now()) {
    if (!text || text.trim().length === 0) return;
    
    this.history.streamerSpeech.push({
      text: text.trim(),
      timestamp: timestamp,
    });
    
    // Ограничиваем размер
    if (this.history.streamerSpeech.length > this.maxSpeechEntries) {
      this.history.streamerSpeech.shift();
    }
    
    // Сохраняем периодически (не на каждое добавление)
    if (this.history.streamerSpeech.length % 10 === 0) {
      await this.save();
    }
  }

  /**
   * Добавление события на стриме
   */
  async addStreamEvent(description, timestamp = Date.now()) {
    if (!description || description.trim().length === 0) return;
    
    this.history.streamEvents.push({
      description: description.trim(),
      timestamp: timestamp,
    });
    
    // Ограничиваем размер
    if (this.history.streamEvents.length > this.maxEventEntries) {
      this.history.streamEvents.shift();
    }
    
    await this.save();
  }

  /**
   * Добавление отправленного сообщения бота
   */
  async addBotMessage(message, timestamp = Date.now()) {
    if (!message || message.trim().length === 0) return;
    
    this.history.botMessages.push({
      message: message.trim(),
      timestamp: timestamp,
    });
    
    // Ограничиваем размер
    if (this.history.botMessages.length > this.maxMessageEntries) {
      this.history.botMessages.shift();
    }
    
    await this.save();
  }

  /**
   * Получение контекста истории для промпта
   * Возвращает форматированную строку с историей
   */
  getHistoryContext(maxSpeechEntries = 10, maxEventEntries = 5, maxMessageEntries = 5) {
    let context = '';
    
    // Речь стримера (последние N фрагментов)
    if (this.history.streamerSpeech.length > 0) {
      const recentSpeech = this.history.streamerSpeech.slice(-maxSpeechEntries);
      const speechText = recentSpeech.map(s => s.text).join('\n');
      context += `\n=== ПРЕДЫДУЩАЯ РЕЧЬ СТРИМЕРА ===\n${speechText}\n`;
    }
    
    // События на стриме (последние N событий)
    if (this.history.streamEvents.length > 0) {
      const recentEvents = this.history.streamEvents.slice(-maxEventEntries);
      const eventsText = recentEvents.map(e => e.description).join('\n');
      context += `\n=== ПРЕДЫДУЩИЕ СОБЫТИЯ НА СТРИМЕ ===\n${eventsText}\n`;
    }
    
    // Сообщения бота (последние N сообщений)
    if (this.history.botMessages.length > 0) {
      const recentMessages = this.history.botMessages.slice(-maxMessageEntries);
      const messagesText = recentMessages.map(m => m.message).join('\n');
      context += `\n=== МОИ ПРЕДЫДУЩИЕ СООБЩЕНИЯ ===\n${messagesText}\n`;
    }
    
    return context;
  }

  /**
   * Ограничение размера истории
   */
  trimHistory() {
    if (this.history.streamerSpeech.length > this.maxSpeechEntries) {
      this.history.streamerSpeech = this.history.streamerSpeech.slice(-this.maxSpeechEntries);
    }
    if (this.history.streamEvents.length > this.maxEventEntries) {
      this.history.streamEvents = this.history.streamEvents.slice(-this.maxEventEntries);
    }
    if (this.history.botMessages.length > this.maxMessageEntries) {
      this.history.botMessages = this.history.botMessages.slice(-this.maxMessageEntries);
    }
  }

  /**
   * Очистка истории
   */
  async clear() {
    this.history = {
      streamerSpeech: [],
      streamEvents: [],
      botMessages: [],
      metadata: {
        sessionStart: Date.now(),
        lastUpdated: Date.now(),
        totalEvents: 0,
      },
    };
    await this.save();
    console.log('[SessionHistory] 🗑️ История очищена');
  }
}
