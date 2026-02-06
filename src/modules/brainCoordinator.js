// Локальный LLM удален - используем только Gemini через ProxyAPI
import { BrainMemory } from './brainMemory.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Мозг-координатор для редактирования и оптимизации промптов ИИ
 * Анализирует задачи и адаптирует промпты для лучших результатов
 */
export class BrainCoordinator {
  constructor(config = {}) {
    this.config = config;
    // Локальный LLM удален - используем только Gemini через ProxyAPI
    this.memory = null; // Память мозга
    
    // Инициализируем память мозга
    this.memory = new BrainMemory({
      maxEntries: config.maxMemoryEntries || 1000,
    });
    
    // Кэш оптимизированных промптов
    this.promptCache = new Map();
    
    // Режим работы: 'normal' (основной) или 'training' (обучение)
    this.mode = config.mode || 'normal';
    
    // Внутреннее состояние мозга
    this.state = {
      lastMessageTime: 0,
      // messageCooldown убран - мозг сам решает когда отправлять сообщения
      currentTime: Date.now(),
      lastScreenshotRequest: 0, // Время последнего запроса скриншота
      screenshotRequestCount: 0, // Счетчик запросов скриншотов (для контроля частоты)
      screenshotRequestWindow: 0, // Окно времени для подсчета запросов
      screenshotRequestInProgress: false, // Флаг блокировки - запрос в процессе
      // Накопительный текст речи в режиме реального времени
      lastRealtimeText: '', // Последний загруженный накопительный текст
      lastRealtimeTextUpdate: 0, // Время последнего обновления текста
      recentSpeechFragments: [], // Последние фрагменты речи
      realtimeTextUpdateInterval: 5000, // Интервал обновления текста (5 секунд)
      lastSavedFragmentTimestamp: 0, // Время последнего сохраненного фрагмента в память
    };
    
    // Модули для запроса скриншотов
    this.browser = null; // Будет установлен через setBrowser
    this.coordinator = null; // Будет установлен через setCoordinator
    this.imageAnalyzer = null; // Будет установлен через setImageAnalyzer
    
    // Информация о стримере
    this.streamerInfo = null;
    
    // История последних сообщений для проверки на повторения
    this.lastMessages = [];
  }
  
  /**
   * Загрузка информации о стримере из файла
   */
  async loadStreamerInfo() {
    try {
      const streamerInfoPath = path.join(__dirname, '../../data/streamer_info.json');
      const data = await fs.readFile(streamerInfoPath, 'utf-8');
      this.streamerInfo = JSON.parse(data);
    } catch (error) {
      console.warn('[BrainCoordinator] ⚠️ Не удалось загрузить информацию о стримере:', error.message);
      this.streamerInfo = null;
    }
  }
  
  /**
   * Получить текст с информацией о стримере для промпта
   */
  getStreamerInfoContext() {
    if (!this.streamerInfo) {
      return '';
    }
    
    const info = this.streamerInfo;
    const personality = info.personality || {};
    const chatStyle = info.chatStyle || {};
    const preferences = info.preferences || {};
    
    let context = `\n=== ИНФОРМАЦИЯ О СТРИМЕРЕ ===\n`;
    context += `Имя: ${info.displayName || info.name || 'неизвестно'}\n`;
    
    if (personality.description) {
      context += `Характер: ${personality.description}\n`;
    }
    
    if (personality.communicationStyle) {
      context += `Стиль общения: ${personality.communicationStyle}\n`;
    }
    
    if (personality.interests && personality.interests.length > 0) {
      context += `Интересы: ${personality.interests.join(', ')}\n`;
    }
    
    if (chatStyle.preferredLength) {
      context += `\nСтиль чата:\n`;
      context += `- Длина сообщений: ${chatStyle.preferredLength}\n`;
      if (chatStyle.punctuation) context += `- Пунктуация: ${chatStyle.punctuation}\n`;
      if (chatStyle.emotions) context += `- Эмоции: ${chatStyle.emotions}\n`;
      if (chatStyle.slang) context += `- Сленг: ${chatStyle.slang}\n`;
      if (chatStyle.profanity) context += `- Мат: ${chatStyle.profanity}\n`;
    }
    
    if (preferences.respondsTo && preferences.respondsTo.length > 0) {
      context += `\nРеагирует на: ${preferences.respondsTo.join(', ')}\n`;
    }
    
    if (preferences.ignores && preferences.ignores.length > 0) {
      context += `Игнорирует: ${preferences.ignores.join(', ')}\n`;
    }
    
    return context;
  }
  
  /**
   * Фильтрация неправильных фраз из распознавания речи
   * Проверяет качество распознанного текста и отфильтровывает мусор
   */
  filterSpeechErrors(speechText) {
    if (!speechText || !speechText.text) {
      return null;
    }
    
    const text = speechText.text.trim();
    
    // Фильтруем очевидно неправильные фразы
    const errorPatterns = [
      /^[а-яё]{1,2}$/i, // Одна-две буквы (скорее всего ошибка)
      /^[а-яё]{3,5}\s*[а-яё]{1,2}$/i, // Короткие слова с одной-двумя буквами в конце
      /^[а-яё]{1,3}\s+[а-яё]{1,3}$/i, // Два очень коротких слова
      /^[а-яё]{1,2}\s*[а-яё]{1,2}\s*[а-яё]{1,2}$/i, // Три очень коротких слова
    ];
    
    // Проверяем на очевидные ошибки распознавания
    for (const pattern of errorPatterns) {
      if (pattern.test(text) && text.length < 15) {
        return null;
      }
    }
    
    // Проверяем на слишком низкую уверенность
    if (speechText.confidence && speechText.confidence < 0.3) {
      return null;
    }
    
    // Проверяем на бессмысленные комбинации букв
    const meaninglessPattern = /^[а-яё]{1,3}\s*[а-яё]{1,3}\s*[а-яё]{1,3}$/i;
    if (meaninglessPattern.test(text) && text.length < 20) {
      // Проверяем, есть ли хотя бы одно осмысленное слово (длиннее 4 символов)
      const words = text.split(/\s+/);
      const hasMeaningfulWord = words.some(word => word.length >= 4);
      if (!hasMeaningfulWord) {
        return null;
      }
    }
    
    return speechText;
  }

  /**
   * Установка браузера для запроса скриншотов
   */
  setBrowser(browser) {
    this.browser = browser;
  }

  /**
   * Установка координатора для обработки скриншотов
   */
  setCoordinator(coordinator) {
    this.coordinator = coordinator;
  }

  /**
   * Установка анализатора изображений
   */
  setImageAnalyzer(imageAnalyzer) {
    this.imageAnalyzer = imageAnalyzer;
  }
  
  /**
   * Установка координатора для доступа к текущему тексту речи
   */
  setCoordinatorForSpeech(coordinator) {
    this.coordinatorForSpeech = coordinator;
  }

  /**
   * Установка режима работы мозга
   */
  setMode(mode) {
    this.mode = mode;
    console.log(`[BrainCoordinator] 🔄 Режим работы изменен: ${mode === 'training' ? 'ОБУЧЕНИЕ' : 'ОСНОВНОЙ'}`);
  }
  
  /**
   * Получить текущий накопительный текст речи (для мозга)
   * @param {number} lastSeconds - Получить текст за последние N секунд
   * @returns {string} Текущий текст
   */
  getCurrentSpeechText(lastSeconds = null) {
    if (this.coordinatorForSpeech && typeof this.coordinatorForSpeech.getCurrentSpeechText === 'function') {
      return this.coordinatorForSpeech.getCurrentSpeechText(lastSeconds);
    }
    return '';
  }
  
  /**
   * Получить последние фрагменты речи
   * @param {number} count - Количество фрагментов
   * @returns {Array} Массив фрагментов
   */
  getRecentSpeechFragments(count = 5) {
    if (this.coordinatorForSpeech && typeof this.coordinatorForSpeech.getRecentSpeechFragments === 'function') {
      return this.coordinatorForSpeech.getRecentSpeechFragments(count);
    }
    return [];
  }

  /**
   * Записать информацию в память
   * Удобный метод для записи важной информации
   */
  async remember(content, category = 'general', metadata = {}, importance = 5, tags = []) {
    if (this.memory) {
      return await this.memory.remember(content, category, metadata, importance, tags);
    }
    return null;
  }

  /**
   * Вспомнить информацию из памяти
   * Удобный метод для поиска информации
   */
  async recall(filters = {}, limit = 10) {
    if (this.memory) {
      return await this.memory.recall(filters, limit);
    }
    return [];
  }

  /**
   * Получить контекст из памяти для текущей задачи
   * Также включает накопительный текст речи в режиме реального времени
   */
  async getMemoryContext(context = {}) {
    let memoryContext = '';
    
    if (this.memory) {
      try {
        // Ищем релевантные записи
        const relevantMemories = await this.memory.recall({
          minImportance: 6,
          afterTimestamp: Date.now() - 7 * 24 * 60 * 60 * 1000, // Последние 7 дней
        }, 5);

        if (relevantMemories.length > 0) {
          memoryContext = '\n\n=== КОНТЕКСТ ИЗ ПАМЯТИ МОЗГА ===\n';
          relevantMemories.forEach((memory, index) => {
            memoryContext += `[${index + 1}] ${memory.timeString} [${memory.category}] (важность: ${memory.importance})\n`;
            memoryContext += `${memory.content}\n`;
            if (memory.tags.length > 0) {
              memoryContext += `Теги: ${memory.tags.join(', ')}\n`;
            }
            memoryContext += '\n';
          });
        }
      } catch (error) {
        console.warn('[BrainCoordinator] Ошибка получения контекста из памяти:', error);
      }
    }
    
    // Добавляем последние фрагменты речи (только последние 30 секунд)
    // Обновляем фрагменты перед получением контекста
    this.updateRealtimeText();
    // Используем только последние фрагменты, не весь накопительный текст
    const recentFragments = context.recentSpeechFragments || this.state.recentSpeechFragments || [];
    const recentStreamerFragments = recentFragments
      .filter(f => {
        const timeAgo = Date.now() - (f.timestamp || 0);
        return timeAgo < 30000; // Только последние 30 секунд
      })
      .slice(-5); // Последние 5 фрагментов
    
    if (recentStreamerFragments.length > 0) {
      memoryContext += '\n\n=== ПОСЛЕДНИЕ ФРАГМЕНТЫ РЕЧИ (ПОСЛЕДНИЕ 30 СЕКУНД) ===\n';
      recentStreamerFragments.forEach((fragment) => {
        const timeAgo = Math.round((Date.now() - (fragment.timestamp || Date.now())) / 1000);
        memoryContext += `[${timeAgo}с назад] ${fragment.text || ''}\n`;
      });
      
      // Добавляем информацию о последних фрагментах (для совместимости)
      const fragments = recentStreamerFragments;
      if (fragments.length > 0) {
        memoryContext += '\n=== ПОСЛЕДНИЕ ФРАГМЕНТЫ ===\n';
        fragments.forEach(fragment => {
          const timeAgo = Math.round((Date.now() - fragment.timestamp) / 1000);
          memoryContext += `[${timeAgo}с назад] ${fragment.text}\n`;
        });
      }
    }
    
    return memoryContext;
  }

  async init() {
    // Локальный LLM удален - используем только Gemini через ProxyAPI
    
    // Инициализируем память мозга (создает директории)
    if (this.memory) {
      await this.memory.init();
    }
    
    // Загружаем информацию о стримере
    await this.loadStreamerInfo();
  }

  /**
   * Оптимизация промпта для анализа изображений
   * ВАЖНО: Мозг НЕ может трогать основной промпт, только дописывать подробности
   */
  async optimizeImagePrompt(basePrompt, context = {}) {
    const cacheKey = `image_${basePrompt.substring(0, 50)}`;
    
    if (this.promptCache.has(cacheKey)) {
      return this.promptCache.get(cacheKey);
    }

    // Мозг НЕ может менять основной промпт, только дописывать подробности и вопросы
    // Добавляем дополнительные инструкции на основе контекста
    let additionalDetails = '';
    
    if (context.recentSpeakers && context.recentSpeakers.length > 0) {
      additionalDetails += `\n\nДОПОЛНИТЕЛЬНЫЙ КОНТЕКСТ ОТ МОЗГА:\n`;
      additionalDetails += `- Недавно говорили: ${context.recentSpeakers.map(s => s.name).join(', ')}\n`;
    }
    
    if (context.chatHistory && context.chatHistory.length > 0) {
      const recentChat = context.chatHistory.slice(-3).map(m => `${m.username}: ${m.message}`).join('\n');
      additionalDetails += `- Последние сообщения в чате:\n${recentChat}\n`;
    }
    
    if (context.time) {
      const timeStr = new Date(context.time).toLocaleString('ru-RU');
      additionalDetails += `- Время анализа: ${timeStr}\n`;
    }


    // Дописывание подробностей теперь делается напрямую мозгом
    // Просто добавляем подробности к основному промпту
    const enhancedPrompt = basePrompt + (additionalDetails ? '\n\n' + additionalDetails : '');
    this.promptCache.set(cacheKey, enhancedPrompt);
    
    
    // Записываем в память информацию о дополнении промпта
    if (additionalDetails && this.memory) {
      this.memory.remember(
        `Дополнен промпт анализа изображений: ${additionalDetails.substring(0, 200)}`,
        'prompt_optimization',
        { type: 'image_analysis', context },
        6,
        ['prompt', 'image', 'optimization']
      ).catch(err => {
        console.warn('[BrainCoordinator] Ошибка записи в память:', err.message);
      });
    }
    
    return enhancedPrompt;
  }


  /**
   * Оптимизация промпта для генерации сообщений
   * ВАЖНО: Мозг может трогать промпт, но НЕ может менять пункты про банворды, запрещенные темы и политику
   * Автоматически добавляет накопительный текст речи в контекст
   */
  async optimizeMessagePrompt(basePrompt, context = {}) {
    // Обновляем накопительный текст перед оптимизацией промпта
    this.updateRealtimeText();
    
    // Добавляем накопительный текст в контекст, если его нет
    // Используем только последние фрагменты, не весь накопительный текст
    if (!context.recentSpeechFragments && this.state.recentSpeechFragments.length > 0) {
      context.recentSpeechFragments = this.state.recentSpeechFragments;
    }
    const cacheKey = `message_${basePrompt.substring(0, 50)}_${context.messageLength || 'default'}`;
    
    if (this.promptCache.has(cacheKey)) {
      return this.promptCache.get(cacheKey);
    }

    // Извлекаем защищенные секции (банворды, запрещенные темы, политика)
    const protectedSections = this.extractProtectedSections(basePrompt);
    
    // Убираем защищенные секции из промпта для редактирования
    let editablePrompt = basePrompt;
    for (const section of protectedSections) {
      editablePrompt = editablePrompt.replace(section.text, `[ЗАЩИЩЕННАЯ СЕКЦИЯ: ${section.type}]`);
    }

    // Оптимизация промпта теперь делается напрямую мозгом
    // История промптов отключена - используем только Gemini через ProxyAPI

    // Адаптируем промпт под задачу генерации сообщений
      const optimizedPrompt = this.enhancePromptManually(
        editablePrompt,
      'message_generation',
      context
      );

    // Убеждаемся, что optimizedPrompt - строка
    const optimizedText = typeof optimizedPrompt === 'string' ? optimizedPrompt : (optimizedPrompt?.text || String(optimizedPrompt || editablePrompt));

    // Восстанавливаем защищенные секции
    let finalPrompt = optimizedText;
    for (const section of protectedSections) {
      finalPrompt = finalPrompt.replace(`[ЗАЩИЩЕННАЯ СЕКЦИЯ: ${section.type}]`, section.text);
    }

    this.promptCache.set(cacheKey, finalPrompt);
    
    // НЕ сохраняем промпт здесь - сохранение происходит в generateMessage после оптимизации
    // Это позволяет избежать дублирования и сохранять финальный промпт после всех изменений
    
    return finalPrompt;
  }

  /**
   * Генерация сообщения для чата
   * Мозг использует информацию с картинки, речь и чат для генерации сообщения
   */
  /**
   * @deprecated Генерация сообщений теперь происходит через Gemini в coordinator
   * Этот метод оставлен для обратной совместимости, но всегда возвращает null
   */
  async generateMessage(context) {
    console.log('[BrainCoordinator] ⚠️ generateMessage устарел - генерация через Gemini в coordinator');
    return null;
  }

  /**
   * Фильтрация сообщения (для использования с Gemini и другими источниками)
   * Применяет ту же логику фильтрации, что и в generateMessage
   */
  filterMessage(message) {
    if (!message || typeof message !== 'string') {
      return null;
    }

    // Очищаем сообщение от кавычек в начале и конце
    message = message.replace(/^["'«»]|["'«»]$/g, '').trim();
    
    // Удаляем слэши в начале и конце
    message = message.replace(/^\/+|\/+$/g, '').trim();
    
    // Проверяем на различные варианты "null"
    const messageLower = message.toLowerCase().trim();
    if (messageLower === 'null' || messageLower === '/null' || messageLower === 'null/' || messageLower === '"/null"' || messageLower === "'/null'") {
      return null;
    }
    
    if (message.length < 3) {
      return null;
    }
    
    // Удаляем "null" в конце сообщения
    message = message.replace(/\s+null\s*$/i, '').trim();
    message = message.replace(/\s+\/null\s*$/i, '').trim();
    
    // Удаляем мета-комментарии
    const explanationPattern = /\n.*?(?:this message|это сообщение|explanation|объяснение|note|примечание)/i;
    message = message.split(explanationPattern)[0].trim();
    
    // Удаляем повторения инструкций
    const instructionPatterns = [
      /按照中文指令.*?$/i,
      /我现在将作为.*?$/i,
      /必须遵循以下规则.*?$/i,
      /Понял инструкцию.*?$/i,
      /Начинаю участие.*?$/i,
      /Ты активный зритель.*?$/i,
      /КРИТИЧЕСКИ ВАЖНО.*?$/i,
      /ОБЯЗАТЕЛЬНО.*?$/i,
      /ЗАПРЕЩЕНО.*?$/i,
      /Верни ТОЛЬКО.*?$/i,
      /Сообщения КОРОТКИЕ.*?$/i,
    ];
    
    for (const pattern of instructionPatterns) {
      message = message.replace(pattern, '').trim();
    }
    
    // Удаляем части системного промпта
    const systemPromptPhrases = [
      'Ты активный зритель',
      'Твое имя:',
      'КРИТИЧЕСКИ ВАЖНО',
      'ОБЯЗАТЕЛЬНО пиши',
      'ЗАПРЕЩЕНО писать',
      'СТИЛЬ СООБЩЕНИЙ',
      'ТВОЙ ХАРАКТЕР',
      'ВАЖНО - ЧЕСТНОСТЬ',
      'ЗАПРЕЩЕНО:',
      'ВСЕ ОСТАЛЬНОЕ РАЗРЕШЕНО',
      'Ты можешь:',
      'БУДЬ АКТИВНЫМ',
      'Верни ТОЛЬКО',
      'НЕ пиши',
      'Без дополнительных объяснений',
    ];
    
    for (const phrase of systemPromptPhrases) {
      if (message.toLowerCase().startsWith(phrase.toLowerCase())) {
        const sentences = message.split(/[.!?]\s+/);
        if (sentences.length > 1) {
          message = sentences.slice(1).join('. ').trim();
        } else {
          message = message.substring(phrase.length).trim();
        }
      }
    }
    
    // Проверка на русский язык
    const chineseChars = /[\u4e00-\u9fff]/g;
    const japaneseChars = /[\u3040-\u309F\u30A0-\u30FF]/g;
    const koreanChars = /[\uAC00-\uD7AF]/g;
    const arabicChars = /[\u0600-\u06FF]/g;
    const cyrillicChars = /[а-яёА-ЯЁ]/g;
    
    const totalChars = message.length;
    const chineseCount = (message.match(chineseChars) || []).length;
    const japaneseCount = (message.match(japaneseChars) || []).length;
    const koreanCount = (message.match(koreanChars) || []).length;
    const arabicCount = (message.match(arabicChars) || []).length;
    const cyrillicCount = (message.match(cyrillicChars) || []).length;
    const englishWords = /\b[a-zA-Z]{4,}\b/g;
    const englishWordCount = (message.match(englishWords) || []).length;
    
    if (chineseCount > 0 || japaneseCount > 0 || koreanCount > 0 || arabicCount > 0) {
      return null;
    }
    
    const chinesePatterns = [
      /按照/i, /中文/i, /我现在/i, /必须遵循/i, /我现在将/i,
      /[\u4e00-\u9fff]{2,}/g,
    ];
    for (const pattern of chinesePatterns) {
      if (pattern.test(message)) {
        return null;
      }
    }
    
    if (cyrillicCount === 0 && totalChars > 5) {
      return null;
    }
    
    const russianRatio = cyrillicCount / totalChars;
    if (englishWordCount > 2 && russianRatio < 0.3 && totalChars > 10) {
      return null;
    }
    
    if (russianRatio < 0.3 && totalChars > 15) {
      return null;
    }
    
    // Удаляем префиксы и markdown
    message = message.replace(/^(?:\[?БОТ\]?|Я:|Бот:|Bot:)\s*/i, '').trim();
    message = message.replace(/^\*\*?medved12sensei\*\*?:?\s*/i, '').trim();
    message = message.replace(/^medved12sensei:?\s*/i, '').trim();
    message = message.replace(/^MEDVED12SENSEI:?\s*/i, '').trim();
    message = message.replace(/\*\*([^*]+)\*\*/g, '$1');
    message = message.replace(/\*([^*]+)\*/g, '$1');
    message = message.replace(/__([^_]+)__/g, '$1');
    message = message.replace(/_([^_]+)_/g, '$1');
    message = message.replace(/##+\s*/g, '');
    message = message.replace(/^#+\s*/g, '');
    message = message.replace(/\b[a-zA-Z]{4,}\b/g, '').trim();
    
    // Удаляем фразы-префиксы
    const reactionPhrases = [
      /^вот моя реакция:?\s*/i, /^моя реакция:?\s*/i, /^я думаю:?\s*/i,
      /^вот что я думаю:?\s*/i, /^я считаю:?\s*/i, /^мне кажется:?\s*/i,
      /^по моему мнению:?\s*/i, /^вот мой ответ:?\s*/i, /^мой ответ:?\s*/i,
      /^вот моя рецензия:?\s*/i, /^моя рецензия:?\s*/i,
      /^вот мой комментарий:?\s*/i, /^мой комментарий:?\s*/i,
      /^вот что я хочу сказать:?\s*/i, /^я хочу сказать:?\s*/i,
      /^вот мое мнение:?\s*/i, /^мое мнение:?\s*/i,
      /^моя первая реакция:?\s*/i, /^первая реакция:?\s*/i,
    ];
    for (const pattern of reactionPhrases) {
      message = message.replace(pattern, '').trim();
    }
    
    // Удаляем повторения инструкций
    const systemPromptPatterns = [
      /^юмор и реакции:?\s*/i, /^юморист:?\s*/i,
      /^я готов:?\s*/i, /^я готов запомнить:?\s*/i, /^я готов быть:?\s*/i,
      /^я - медвед12sensei:?\s*/i, /^я медвед12sensei:?\s*/i, /^медвед12sensei:?\s*/i,
      /^визуальный анализ стрима:?\s*/i, /^информация о стриме:?\s*/i,
    ];
    for (const pattern of systemPromptPatterns) {
      message = message.replace(pattern, '').trim();
    }
    
    // Удаляем эмодзи
    const emojiPattern = /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F600}-\u{1F64F}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{1F900}-\u{1F9FF}]|[\u{1FA00}-\u{1FA6F}]|[\u{1FA70}-\u{1FAFF}]/gu;
    message = message.replace(emojiPattern, '').trim();
    
    // Удаляем общие фразы
    const genericPhrases = /^(?:понял|ок|хорошо|ясно|ага|да|нет|ладно|окей)\s*[.,!]?\s*$/i;
    if (genericPhrases.test(message) && message.length < 10) {
      return null;
    }
    
    // Удаляем объяснения
    const explanationPatterns = [
      /^вот моя реакция:?\s*/i, /^моя реакция:?\s*/i, /^я думаю:?\s*/i,
      /^ты действительно\s+/i, /^ты\s+[а-яё]+\s+стример/i,
      /^братишкинoff,?\s+/i, /^братишкинофф,?\s+/i,
    ];
    for (const pattern of explanationPatterns) {
      message = message.replace(pattern, '').trim();
    }
    
    // Удаляем упоминания стримера в конце
    const streamerMentionPatterns = [
      /,\s*ты\s+действительно\s+[а-яё\s]+стример[!.]?$/i,
      /,\s*ты\s+[а-яё\s]+стример[!.]?$/i,
      /,\s*братишкинoff[!.]?$/i, /,\s*братишкинофф[!.]?$/i,
      /\s+братишкинoff,?\s+ты\s+[а-яё\s]+[!.]?$/i,
      /\s+братишкинофф,?\s+ты\s+[а-яё\s]+[!.]?$/i,
    ];
    for (const pattern of streamerMentionPatterns) {
      message = message.replace(pattern, '').trim();
    }
    
    // Оставляем только первую строку
    if (message.includes('\n')) {
      const firstLine = message.split('\n')[0].trim();
      if (firstLine.length >= 3) {
        message = firstLine;
      } else {
        const secondLine = message.split('\n')[1]?.trim();
        if (secondLine && secondLine.length >= 3) {
          message = secondLine;
        }
      }
    }
    
    // Обрезаем до 50 символов
    if (message.length > 50) {
      const sentences = message.split(/[.!?]\s+/);
      if (sentences.length > 1) {
        let truncated = '';
        for (const sentence of sentences) {
          if ((truncated + sentence).length <= 50) {
            truncated += (truncated ? '. ' : '') + sentence;
          } else {
            break;
          }
        }
        if (truncated.length > 0) {
          message = truncated;
        } else {
          message = message.substring(0, 47) + '...';
        }
      } else {
        message = message.substring(0, 47) + '...';
      }
    }
    
    // Проверка на повторения
    if (this.lastMessages && this.lastMessages.length >= 3) {
      const lastThree = this.lastMessages.slice(-3);
      if (lastThree.every(m => m.toLowerCase() === message.toLowerCase())) {
        return null;
      }
    }
    
    // Сохраняем для проверки на повторения
    if (!this.lastMessages) {
      this.lastMessages = [];
    }
    this.lastMessages.push(message);
    if (this.lastMessages.length > 5) {
      this.lastMessages.shift();
    }
    
    // Ограничиваем длину
    if (message.length > 200) {
      message = message.substring(0, 197) + '...';
    }
    
    if (message.length < 3) {
      return null;
    }
    
    return message;
  }


  /**
   * Извлечение защищенных секций из промпта
   * ВАЖНО: Мозг защищает только банворды Twitch для генератора сообщений
   * Мозг сам ограничен запрещенными темами и политикой
   */
  extractProtectedSections(prompt) {
    const sections = [];
    
    // Ищем секции с банвордами Twitch (это защищено для генератора сообщений)
    const bannedWordsPattern = /банворд[^]*?(?=РАЗРЕШЕНО|ПРАВИЛА|КОНТЕКСТ|$)/i;
    const bannedMatch = prompt.match(bannedWordsPattern);
    if (bannedMatch) {
      sections.push({
        type: 'twitch_banned_words',
        text: bannedMatch[0],
      });
    }

    // Ищем секции с запрещенными темами (мозг сам ограничен этим)
    const forbiddenTopicsPattern = /запрещенн[^]*?(?=РАЗРЕШЕНО|ПРАВИЛА|КОНТЕКСТ|$)/i;
    const forbiddenMatch = prompt.match(forbiddenTopicsPattern);
    if (forbiddenMatch) {
      sections.push({
        type: 'forbidden_topics',
        text: forbiddenMatch[0],
      });
    }

    // Ищем упоминания политики (мозг сам ограничен этим)
    const politicsPattern = /политик[^]*?(?=РАЗРЕШЕНО|ПРАВИЛА|КОНТЕКСТ|$)/i;
    const politicsMatch = prompt.match(politicsPattern);
    if (politicsMatch) {
      sections.push({
        type: 'politics',
        text: politicsMatch[0],
      });
    }

    return sections;
  }


  /**
   * Запрос скриншота от мозга
   * Мозг сам решает, нужен ли скриншот, и ограничивает частоту для экономии денег
   * @param {Object} context - контекст стрима
   * @returns {Promise<Object|null>} - результат анализа изображения или null если запрос отклонен
   */
  /**
   * Запрос скриншота (ОТКЛЮЧЕН - скриншоты делаются автоматически каждые 10 секунд)
   * Мозг не может самостоятельно запрашивать изображения
   */
  async requestScreenshot(context = {}) {
    // Скриншоты делаются автоматически каждые 10 секунд
    // Мозг не может запрашивать их самостоятельно
    return null;
  }

  /**
   * Адаптация промпта под конкретную задачу
   */
  /**
   * Ручное улучшение промпта
   */
  enhancePromptManually(basePrompt, taskType, context) {
    let enhanced = basePrompt;

    if (taskType === 'message_generation') {
      // Добавляем инструкции по длине сообщений
      const lengthHint = context.desiredLength 
        ? `\nВАЖНО О ДЛИНЕ: Сообщение должно быть примерно ${context.desiredLength} символов. ${context.desiredLength < 50 ? 'ОЧЕНЬ КОРОТКО!' : context.desiredLength > 150 ? 'Можешь быть подробнее' : 'Средняя длина'}.\n`
        : '\nВАЖНО О ДЛИНЕ: Сообщение должно быть уместной длины. Если ситуация требует - можешь быть подробнее. Если это простая реакция - коротко.\n';
      
      enhanced += lengthHint;
    }

    return enhanced;
  }

  /**
   * Обновление времени и проверка, нужно ли ждать перед генерацией сообщения
   * Автоматически обновляет накопительный текст речи из coordinator
   * @param {number} currentTime - текущее время (timestamp)
   * @param {Object} context - контекст стрима
   * @returns {Object} - решение о необходимости ожидания
   */
  updateTime(currentTime, context = {}) {
    const now = currentTime || Date.now();
    
    // Если это первое сообщение при запуске - разрешаем сразу
    if (context.isFirstMessage) {
      return {
        shouldWait: false,
        reason: 'Первое сообщение при запуске',
        timeRemaining: 0,
      };
    }
    
    const lastMessageTime = this.state.lastMessageTime || 0;
    const timeSinceLastMessage = now - lastMessageTime;
    
    // Периодически обновляем накопительный текст речи из coordinator
    const timeSinceLastTextUpdate = now - this.state.lastRealtimeTextUpdate;
    if (timeSinceLastTextUpdate >= this.state.realtimeTextUpdateInterval) {
      this.updateRealtimeText();
    }
    
    // Минимальная пауза между сообщениями - 2 секунды (уменьшено для большей активности)
    const minPause = 2000;
    
    if (timeSinceLastMessage < minPause) {
      return {
        shouldWait: true,
        reason: 'Минимальная пауза между сообщениями',
        timeRemaining: minPause - timeSinceLastMessage,
      };
    }
    
    // Если нет интересных событий - увеличиваем паузу до 5 секунд (уменьшено для большей активности)
    // Учитываем последние фрагменты речи (не весь накопительный текст)
    const recentFragments = context.recentSpeechFragments || [];
    const hasRecentSpeech = recentFragments.length > 0 && 
      recentFragments.some(f => {
        const timeAgo = Date.now() - (f.timestamp || 0);
        return timeAgo < 60000; // Есть фрагменты за последние 60 секунд (увеличено окно)
      });
    
    // Смягчаем условия для "интересных событий" - ИИ должен быть более активным
    const hasInterestingEvents = 
      (context.imageAnalysis && context.imageAnalysis.confidence > 0.3) || // Снижено с 0.5 до 0.3
      (context.speechText && context.speechText.text && context.speechText.text.length > 3) || // Снижено с 5 до 3
      hasRecentSpeech || // Есть недавние фрагменты речи
      (context.chatHistory && context.chatHistory.length > 0); // Есть сообщения в чате
    
    if (!hasInterestingEvents && timeSinceLastMessage < 5000) {
      return {
        shouldWait: true,
        reason: 'Нет интересных событий, увеличиваем паузу',
        timeRemaining: 5000 - timeSinceLastMessage,
      };
    }
    
    return {
      shouldWait: false,
      reason: 'Можно генерировать сообщение',
      timeRemaining: 0,
    };
  }
  
  /**
   * Обновление накопительного текста речи из coordinator
   * Вызывается периодически для синхронизации состояния мозга
   */
  updateRealtimeText() {
    if (!this.coordinatorForSpeech) {
      return;
    }
    
    try {
      // Получаем текущий накопительный текст
      const currentText = this.getCurrentSpeechText();
      const recentFragments = this.getRecentSpeechFragments(20);
      
      // Обновляем состояние мозга
      this.state.lastRealtimeText = currentText;
      this.state.recentSpeechFragments = recentFragments;
      this.state.lastRealtimeTextUpdate = Date.now();
      
      // Сохраняем важные фрагменты в память (если есть новые)
      if (recentFragments.length > 0 && this.memory) {
        const lastSavedFragment = this.state.lastSavedFragmentTimestamp || 0;
        const newFragments = recentFragments.filter(f => f.timestamp > lastSavedFragment);
        
        if (newFragments.length > 0) {
          // Сохраняем только важные фрагменты (длинные или содержащие ключевые слова)
          newFragments.forEach(fragment => {
            if (fragment.text && fragment.text.length > 15) {
              this.memory.remember(
                `Речь: ${fragment.text}`,
                'speech_realtime',
                { 
                  timestamp: fragment.timestamp,
                  source: 'realtime_speech_buffer'
                },
                5, // Средняя важность
                ['speech', 'realtime', 'context']
              ).catch(() => {}); // Не блокируем если ошибка
            }
          });
          
          // Обновляем время последнего сохраненного фрагмента
          this.state.lastSavedFragmentTimestamp = Math.max(
            ...newFragments.map(f => f.timestamp)
          );
        }
      }
    } catch (error) {
      console.warn('[BrainCoordinator] Ошибка обновления текста речи:', error.message);
    }
  }
  
  /**
   * Получить последний загруженный накопительный текст (для мозга)
   * Мозг может вызвать этот метод в любой момент
   * @param {number} lastSeconds - Получить текст за последние N секунд (если нужно обновить)
   * @returns {string} Текущий текст
   */
  getLastRealtimeText(lastSeconds = null) {
    // Если запрошен текст за последние N секунд - обновляем из coordinator
    if (lastSeconds && this.coordinatorForSpeech) {
      return this.getCurrentSpeechText(lastSeconds);
    }
    
    // Возвращаем последний загруженный текст
    return this.state.lastRealtimeText || '';
  }
  
  /**
   * Получить последние фрагменты речи (для мозга)
   * @param {number} count - Количество фрагментов
   * @returns {Array} Массив фрагментов
   */
  getLastSpeechFragments(count = 10) {
    return this.state.recentSpeechFragments.slice(-count);
  }
  
  /**
   * Принудительное обновление текста речи (для мозга)
   * Мозг может вызвать этот метод когда нужно свежий текст
   */
  refreshRealtimeText() {
    this.updateRealtimeText();
    return {
      text: this.state.lastRealtimeText,
      fragments: this.state.recentSpeechFragments,
      timestamp: this.state.lastRealtimeTextUpdate,
    };
  }

  /**
   * Установка времени последнего сообщения
   */
  setLastMessageTime(timestamp) {
    this.state.lastMessageTime = timestamp || Date.now();
  }


}
