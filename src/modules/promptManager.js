import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Менеджер промптов - сохраняет промпты, созданные мозгом, в ресурсные файлы
 */
export class PromptManager {
  constructor(config = {}) {
    this.resourcesDir = path.join(__dirname, '../../resources');
    this.promptsDir = path.join(this.resourcesDir, 'prompts');
    
    // Поддиректории для разных типов промптов
    this.imagePromptsDir = path.join(this.promptsDir, 'image');
    this.messagePromptsDir = path.join(this.promptsDir, 'message');
    this.chatReaderPromptsDir = path.join(this.promptsDir, 'chatreader');
    this.rightHandPromptsDir = path.join(this.promptsDir, 'righthand');
  }

  async init() {
    try {
      // Создаем директории если их нет
      await fs.mkdir(this.resourcesDir, { recursive: true });
      await fs.mkdir(this.promptsDir, { recursive: true });
      await fs.mkdir(this.imagePromptsDir, { recursive: true });
      await fs.mkdir(this.messagePromptsDir, { recursive: true });
      await fs.mkdir(this.chatReaderPromptsDir, { recursive: true });
      await fs.mkdir(this.rightHandPromptsDir, { recursive: true });
      
      this.initialized = true;
      console.log('[PromptManager] ✅ Директории промптов созданы');
    } catch (error) {
      console.error('[PromptManager] Ошибка создания директорий:', error);
      throw error;
    }
  }

  /**
   * Сохранение промпта для анализа изображений
   */
  async saveImagePrompt(prompt, context = {}) {
    // Убеждаемся, что директории созданы
    if (!this.initialized) {
      await this.init();
    }
    
    // Убеждаемся, что prompt - строка
    const promptText = typeof prompt === 'string' ? prompt : (prompt?.text || String(prompt || ''));
    
    const timestamp = Date.now();
    const filename = `image_${timestamp}.txt`;
    const filepath = path.join(this.imagePromptsDir, filename);
    
    const content = `# Промпт для анализа изображений
# Создан мозгом: ${new Date(timestamp).toLocaleString('ru-RU')}
# Контекст: ${JSON.stringify(context, null, 2)}

${promptText}
`;
    
    await fs.writeFile(filepath, content, 'utf-8');
    console.log(`[PromptManager] 💾 Сохранен промпт анализа изображений: ${filename}`);
    
    // Удаляем старые промпты (оставляем только последние 10)
    await this.cleanupOldPrompts('image', 10);
    
    return filepath;
  }

  /**
   * Сохранение промпта для генерации сообщений
   */
  async saveMessagePrompt(prompt, context = {}) {
    // Убеждаемся, что директории созданы
    if (!this.initialized) {
      await this.init();
    }
    
    // Убеждаемся, что prompt - строка
    const promptText = typeof prompt === 'string' ? prompt : (prompt?.text || String(prompt || ''));
    
    const timestamp = Date.now();
    const filename = `message_${timestamp}.txt`;
    const filepath = path.join(this.messagePromptsDir, filename);
    
    const content = `# Промпт для генерации сообщений
# Создан мозгом: ${new Date(timestamp).toLocaleString('ru-RU')}
# Контекст: ${JSON.stringify(context, null, 2)}

${promptText}
`;
    
    await fs.writeFile(filepath, content, 'utf-8');
    console.log(`[PromptManager] 💾 Сохранен промпт генерации сообщений: ${filename}`);
    
    // Удаляем старые промпты (оставляем только последние 10)
    await this.cleanupOldPrompts('message', 10);
    
    return filepath;
  }

  /**
   * Сохранение промпта для ChatReader
   */
  async saveChatReaderPrompt(prompt, context = {}) {
    // Убеждаемся, что директории созданы
    if (!this.initialized) {
      await this.init();
    }
    
    // Убеждаемся, что prompt - строка
    const promptText = typeof prompt === 'string' ? prompt : (prompt?.text || String(prompt || ''));
    
    const timestamp = Date.now();
    const filename = `chatreader_${timestamp}.txt`;
    const filepath = path.join(this.chatReaderPromptsDir, filename);
    
    const content = `# Промпт для сканирования сообщений (ChatReader)
# Создан мозгом: ${new Date(timestamp).toLocaleString('ru-RU')}
# Контекст: ${JSON.stringify(context, null, 2)}

${promptText}
`;
    
    await fs.writeFile(filepath, content, 'utf-8');
    console.log(`[PromptManager] 💾 Сохранен промпт ChatReader: ${filename}`);
    
    // Удаляем старые промпты (оставляем только последние 10)
    await this.cleanupOldPrompts('chatreader', 10);
    
    return filepath;
  }

  /**
   * Сохранение промпта для правой руки
   */
  async saveRightHandPrompt(prompt, task, context = {}) {
    // Убеждаемся, что директории созданы
    if (!this.initialized) {
      await this.init();
    }
    
    const timestamp = Date.now();
    const filename = `righthand_${timestamp}.txt`;
    const filepath = path.join(this.rightHandPromptsDir, filename);
    
    const content = `# Промпт для правой руки
# Создан мозгом: ${new Date(timestamp).toLocaleString('ru-RU')}
# Задача: ${task}
# Контекст: ${JSON.stringify(context, null, 2)}

${prompt}
`;
    
    await fs.writeFile(filepath, content, 'utf-8');
    console.log(`[PromptManager] 💾 Сохранен промпт правой руки: ${filename}`);
    return filepath;
  }

  /**
   * Загрузка последнего промпта по типу
   */
  async loadLatestPrompt(type) {
    let dir;
    switch (type) {
      case 'image':
        dir = this.imagePromptsDir;
        break;
      case 'message':
        dir = this.messagePromptsDir;
        break;
      case 'chatreader':
        dir = this.chatReaderPromptsDir;
        break;
      case 'righthand':
        dir = this.rightHandPromptsDir;
        break;
      default:
        return null;
    }

    try {
      const files = await fs.readdir(dir);
      const txtFiles = files.filter(f => f.endsWith('.txt')).sort().reverse();
      
      if (txtFiles.length === 0) {
        return null;
      }

      const latestFile = path.join(dir, txtFiles[0]);
      const content = await fs.readFile(latestFile, 'utf-8');
      
      // Извлекаем промпт (после заголовка)
      const promptMatch = content.match(/# Контекст:[\s\S]*?\n\n([\s\S]*)/);
      return promptMatch ? promptMatch[1].trim() : content;
    } catch (error) {
      console.error(`[PromptManager] Ошибка загрузки промпта ${type}:`, error);
      return null;
    }
  }

  /**
   * Получить список всех промптов по типу
   */
  async listPrompts(type) {
    let dir;
    switch (type) {
      case 'image':
        dir = this.imagePromptsDir;
        break;
      case 'message':
        dir = this.messagePromptsDir;
        break;
      case 'chatreader':
        dir = this.chatReaderPromptsDir;
        break;
      case 'righthand':
        dir = this.rightHandPromptsDir;
        break;
      default:
        return [];
    }

    try {
      const files = await fs.readdir(dir);
      return files.filter(f => f.endsWith('.txt')).sort().reverse();
    } catch (error) {
      return [];
    }
  }

  /**
   * Очистка старых промптов (оставляет только последние N)
   */
  async cleanupOldPrompts(type, keepCount = 10) {
    let dir;
    switch (type) {
      case 'image':
        dir = this.imagePromptsDir;
        break;
      case 'message':
        dir = this.messagePromptsDir;
        break;
      case 'chatreader':
        dir = this.chatReaderPromptsDir;
        break;
      case 'righthand':
        dir = this.rightHandPromptsDir;
        break;
      default:
        return;
    }

    try {
      const files = await fs.readdir(dir);
      const txtFiles = files.filter(f => f.endsWith('.txt'));
      
      // Сортируем по timestamp в имени файла (формат: type_timestamp.txt)
      const filesWithTimestamp = txtFiles.map(file => {
        // Извлекаем timestamp из имени файла (например: message_1770295949410.txt)
        const match = file.match(/_(\d+)\.txt$/);
        const timestamp = match ? parseInt(match[1], 10) : 0;
        return { file, timestamp };
      }).sort((a, b) => b.timestamp - a.timestamp); // Сортируем по убыванию (новые первыми)
      
      if (filesWithTimestamp.length <= keepCount) {
        return; // Не нужно удалять
      }

      // Удаляем старые файлы (оставляем только первые keepCount)
      const filesToDelete = filesWithTimestamp.slice(keepCount);
      for (const { file } of filesToDelete) {
        const filepath = path.join(dir, file);
        await fs.unlink(filepath).catch(() => {}); // Игнорируем ошибки
      }
      
      if (filesToDelete.length > 0) {
        console.log(`[PromptManager] 🗑️ Удалено ${filesToDelete.length} старых промптов типа ${type}`);
      }
    } catch (error) {
      console.warn(`[PromptManager] Ошибка очистки промптов ${type}:`, error.message);
    }
  }

  /**
   * Получить историю промптов для контекста (последние N)
   */
  async getPromptHistory(type, count = 5) {
    let dir;
    switch (type) {
      case 'image':
        dir = this.imagePromptsDir;
        break;
      case 'message':
        dir = this.messagePromptsDir;
        break;
      case 'chatreader':
        dir = this.chatReaderPromptsDir;
        break;
      case 'righthand':
        dir = this.rightHandPromptsDir;
        break;
      default:
        return [];
    }

    try {
      const files = await fs.readdir(dir);
      const txtFiles = files.filter(f => f.endsWith('.txt')).sort().reverse().slice(0, count);
      
      const history = [];
      for (const file of txtFiles) {
        const filepath = path.join(dir, file);
        const content = await fs.readFile(filepath, 'utf-8');
        
        // Извлекаем промпт (после заголовка)
        const promptMatch = content.match(/# Контекст:[\s\S]*?\n\n([\s\S]*)/);
        const prompt = promptMatch ? promptMatch[1].trim() : content;
        
        history.push({
          filename: file,
          prompt: prompt,
          timestamp: parseInt(file.match(/\d+/)?.[0] || '0'),
        });
      }
      
      return history;
    } catch (error) {
      console.warn(`[PromptManager] Ошибка загрузки истории промптов ${type}:`, error.message);
      return [];
    }
  }
}
