import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Память мозга - структурированное хранилище информации
 * Мозг может записывать полезную информацию и обращаться к ней при необходимости
 */
export class BrainMemory {
  constructor(config = {}) {
    this.memoryDir = path.join(__dirname, '../../resources');
    this.memoryFile = path.join(this.memoryDir, 'brain_memory.json');
    
    // Структура памяти
    this.memory = {
      entries: [], // Массив записей
      metadata: {
        version: '1.0',
        createdAt: Date.now(),
        lastUpdated: Date.now(),
        totalEntries: 0,
      },
    };
    
    // Максимальное количество записей (чтобы файл не раздувался)
    this.maxEntries = config.maxEntries || 1000;
    this.initialized = false;
  }

  /**
   * Инициализация памяти - загрузка из файла
   */
  async init() {
    try {
      // Создаем директорию если её нет
      await fs.mkdir(this.memoryDir, { recursive: true });
      
      // Пытаемся загрузить существующую память
      try {
        const data = await fs.readFile(this.memoryFile, 'utf-8');
        this.memory = JSON.parse(data);
        console.log(`[BrainMemory] 💾 Память загружена: ${this.memory.entries.length} записей`);
      } catch (error) {
        // Файл не существует - создаем новую память
        console.log('[BrainMemory] 💾 Создана новая память');
        await this.save();
      }
      
      this.initialized = true;
    } catch (error) {
      console.error('[BrainMemory] Ошибка инициализации:', error);
      throw error;
    }
  }

  /**
   * Сохранение памяти в файл
   */
  async save() {
    try {
      // Убеждаемся, что директория создана
      await fs.mkdir(this.memoryDir, { recursive: true });
      
      this.memory.metadata.lastUpdated = Date.now();
      this.memory.metadata.totalEntries = this.memory.entries.length;
      
      await fs.writeFile(
        this.memoryFile,
        JSON.stringify(this.memory, null, 2),
        'utf-8'
      );
    } catch (error) {
      console.error('[BrainMemory] Ошибка сохранения памяти:', error);
    }
  }

  /**
   * Запись информации в память
   * @param {string} content - Содержимое записи
   * @param {string} category - Категория (например: 'prompt_optimization', 'chat_pattern', 'user_behavior', 'context')
   * @param {object} metadata - Дополнительные метаданные
   * @param {number} importance - Важность (1-10, где 10 - самая важная)
   * @param {string[]} tags - Теги для поиска
   */
  async remember(content, category = 'general', metadata = {}, importance = 5, tags = []) {
    // Убеждаемся, что память инициализирована
    if (!this.initialized) {
      await this.init();
    }
    
    const entry = {
      id: `mem_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
      timeString: new Date().toLocaleString('ru-RU'),
      content: content,
      category: category,
      importance: Math.max(1, Math.min(10, importance)), // Ограничиваем 1-10
      tags: Array.isArray(tags) ? tags : [tags],
      metadata: metadata,
    };

    // Добавляем в начало (новые записи сверху)
    this.memory.entries.unshift(entry);

    // Ограничиваем количество записей
    if (this.memory.entries.length > this.maxEntries) {
      // Удаляем самые старые записи с низкой важностью
      this.memory.entries.sort((a, b) => {
        if (a.importance !== b.importance) {
          return b.importance - a.importance; // Сначала по важности
        }
        return b.timestamp - a.timestamp; // Потом по времени
      });
      
      // Оставляем только maxEntries записей
      this.memory.entries = this.memory.entries.slice(0, this.maxEntries);
      
      // Сортируем обратно по времени (новые сверху)
      this.memory.entries.sort((a, b) => b.timestamp - a.timestamp);
    }

    await this.save();
    console.log(`[BrainMemory] 💾 Записано в память: [${category}] ${content.substring(0, 50)}...`);
    
    return entry.id;
  }

  /**
   * Поиск записей в памяти
   * @param {object} filters - Фильтры поиска
   * @param {number} limit - Максимальное количество результатов
   */
  async recall(filters = {}, limit = 10) {
    let results = [...this.memory.entries];

    // Фильтр по категории
    if (filters.category) {
      results = results.filter(entry => entry.category === filters.category);
    }

    // Фильтр по тегам
    if (filters.tags && filters.tags.length > 0) {
      const searchTags = Array.isArray(filters.tags) ? filters.tags : [filters.tags];
      results = results.filter(entry => 
        searchTags.some(tag => entry.tags.includes(tag))
      );
    }

    // Фильтр по содержимому (поиск по тексту)
    if (filters.content) {
      const searchText = filters.content.toLowerCase();
      results = results.filter(entry => 
        entry.content.toLowerCase().includes(searchText)
      );
    }

    // Фильтр по минимальной важности
    if (filters.minImportance) {
      results = results.filter(entry => entry.importance >= filters.minImportance);
    }

    // Фильтр по времени (после определенной даты)
    if (filters.afterTimestamp) {
      results = results.filter(entry => entry.timestamp >= filters.afterTimestamp);
    }

    // Фильтр по времени (до определенной даты)
    if (filters.beforeTimestamp) {
      results = results.filter(entry => entry.timestamp <= filters.beforeTimestamp);
    }

    // Сортируем по важности и времени
    results.sort((a, b) => {
      if (a.importance !== b.importance) {
        return b.importance - a.importance;
      }
      return b.timestamp - a.timestamp;
    });

    // Ограничиваем количество результатов
    return results.slice(0, limit);
  }

  /**
   * Получить запись по ID
   */
  async getEntry(id) {
    return this.memory.entries.find(entry => entry.id === id);
  }

  /**
   * Получить последние записи
   */
  async getRecent(limit = 10) {
    return this.memory.entries.slice(0, limit);
  }

  /**
   * Получить записи по категории
   */
  async getByCategory(category, limit = 10) {
    return this.recall({ category }, limit);
  }

  /**
   * Получить важные записи
   */
  async getImportant(minImportance = 7, limit = 10) {
    return this.recall({ minImportance }, limit);
  }

  /**
   * Поиск по тексту
   */
  async search(query, limit = 10) {
    return this.recall({ content: query }, limit);
  }

  /**
   * Удалить запись
   */
  async forget(id) {
    const index = this.memory.entries.findIndex(entry => entry.id === id);
    if (index !== -1) {
      this.memory.entries.splice(index, 1);
      await this.save();
      console.log(`[BrainMemory] 🗑️ Запись удалена: ${id}`);
      return true;
    }
    return false;
  }

  /**
   * Очистить память (удалить все записи)
   */
  async clear() {
    this.memory.entries = [];
    await this.save();
    console.log('[BrainMemory] 🗑️ Память очищена');
  }

  /**
   * Получить статистику памяти
   */
  getStats() {
    const categories = {};
    this.memory.entries.forEach(entry => {
      categories[entry.category] = (categories[entry.category] || 0) + 1;
    });

    return {
      totalEntries: this.memory.entries.length,
      categories: categories,
      oldestEntry: this.memory.entries.length > 0 
        ? this.memory.entries[this.memory.entries.length - 1].timeString 
        : null,
      newestEntry: this.memory.entries.length > 0 
        ? this.memory.entries[0].timeString 
        : null,
      averageImportance: this.memory.entries.length > 0
        ? (this.memory.entries.reduce((sum, e) => sum + e.importance, 0) / this.memory.entries.length).toFixed(2)
        : 0,
    };
  }

  /**
   * Экспорт памяти в читаемый формат
   */
  async export(format = 'text') {
    if (format === 'text') {
      let text = `=== ПАМЯТЬ МОЗГА ===\n`;
      text += `Всего записей: ${this.memory.entries.length}\n`;
      text += `Последнее обновление: ${new Date(this.memory.metadata.lastUpdated).toLocaleString('ru-RU')}\n\n`;

      this.memory.entries.forEach((entry, index) => {
        text += `[${index + 1}] ${entry.timeString} [${entry.category}] (важность: ${entry.importance})\n`;
        if (entry.tags.length > 0) {
          text += `Теги: ${entry.tags.join(', ')}\n`;
        }
        text += `${entry.content}\n`;
        if (Object.keys(entry.metadata).length > 0) {
          text += `Метаданные: ${JSON.stringify(entry.metadata, null, 2)}\n`;
        }
        text += `\n`;
      });

      return text;
    }

    return JSON.stringify(this.memory, null, 2);
  }
}
