/**
 * Модуль обучения мозга
 * В режиме обучения мозг напрямую получает сообщения из чата
 * и обучается формировать промпты для выделения интересных сообщений и написания сообщений
 */
export class BrainTrainer {
  constructor(config = {}) {
    this.config = config;
    this.brainCoordinator = null; // Ссылка на brainCoordinator для доступа к памяти
    
    // Данные для обучения
    this.trainingData = {
      chatMessages: [], // Сообщения из чата
    };
    
    // Статистика обучения
    this.stats = {
      messagesAnalyzed: 0,
    };
  }

  async init() {
    console.log('[BrainTrainer] 🎓 Модуль обучения инициализирован');
  }

  /**
   * Обработка сообщения из чата в режиме обучения
   * Сохраняет данные для последующего дообучения модели
   */
  async processChatMessage(message, context = {}) {
    // НЕ сохраняем описание изображения от Gemini - это техническая информация, не сообщение из чата
    // Сохраняем только реальные сообщения из чата и речь
    const trainingEntry = {
      message,
      context: {
        speechText: context.speechText || null,
        chatHistory: context.chatHistory || [],
        timestamp: Date.now(),
      },
      timestamp: Date.now(),
    };

    this.trainingData.chatMessages.push(trainingEntry);

    // Ограничиваем размер истории
    if (this.trainingData.chatMessages.length > 1000) {
      this.trainingData.chatMessages.shift();
    }

    this.stats.messagesAnalyzed++;

    // Сохраняем данные в файл для последующего обучения
    await this.saveTrainingData(trainingEntry);

  }

  /**
   * Сохранение данных обучения в файл
   */
  async saveTrainingData(entry) {
    try {
      const fs = await import('fs/promises');
      const path = await import('path');
      const { fileURLToPath } = await import('url');
      
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = path.dirname(__filename);
      const dataPath = path.join(__dirname, '../../data/chat_messages.json');
      
      // Читаем существующие данные
      let data = [];
      try {
        const existing = await fs.readFile(dataPath, 'utf-8');
        data = JSON.parse(existing);
      } catch {
        // Файл не существует или пустой
      }
      
      // Добавляем новую запись
      data.push(entry);
      
      // Ограничиваем размер файла (храним последние 5000 записей)
      if (data.length > 5000) {
        data = data.slice(-5000);
      }
      
      // Сохраняем обратно
      await fs.writeFile(dataPath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (error) {
      console.warn('[BrainTrainer] Ошибка сохранения данных обучения:', error.message);
    }
  }

}
