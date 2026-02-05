import { LocalLLM } from './localLLM.js';
import { PromptManager } from './promptManager.js';
import { BrainMemory } from './brainMemory.js';

/**
 * Мозг-координатор для редактирования и оптимизации промптов ИИ
 * Анализирует задачи и адаптирует промпты для лучших результатов
 */
export class BrainCoordinator {
  constructor(config = {}) {
    this.config = config;
    this.localLLM = null;
    this.rightHand = null; // Правая рука для сложных задач
    this.promptManager = null; // Менеджер промптов
    this.memory = null; // Память мозга
    
    if (config.useLocal) {
      this.localLLM = new LocalLLM({
        apiUrl: config.localOllamaUrl || 'http://localhost:11434',
        model: config.localOllamaModel || 'llama2',
      });
    }
    
    // Инициализируем менеджер промптов
    this.promptManager = new PromptManager();
    
    // Инициализируем память мозга
    this.memory = new BrainMemory({
      maxEntries: config.maxMemoryEntries || 1000,
    });
    
    // Кэш оптимизированных промптов
    this.promptCache = new Map();
    
    // История использования промптов для обучения
    this.promptHistory = [];
    
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
    };
    
    // Модули для запроса скриншотов
    this.browser = null; // Будет установлен через setBrowser
    this.coordinator = null; // Будет установлен через setCoordinator
    this.imageAnalyzer = null; // Будет установлен через setImageAnalyzer
  }

  /**
   * Установка правой руки
   */
  setRightHand(rightHand) {
    this.rightHand = rightHand;
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
   */
  async getMemoryContext(context = {}) {
    if (!this.memory) {
      return '';
    }

    try {
      // Ищем релевантные записи
      const relevantMemories = await this.memory.recall({
        minImportance: 6,
        afterTimestamp: Date.now() - 7 * 24 * 60 * 60 * 1000, // Последние 7 дней
      }, 5);

      if (relevantMemories.length === 0) {
        return '';
      }

      let memoryContext = '\n\n=== КОНТЕКСТ ИЗ ПАМЯТИ МОЗГА ===\n';
      relevantMemories.forEach((memory, index) => {
        memoryContext += `[${index + 1}] ${memory.timeString} [${memory.category}] (важность: ${memory.importance})\n`;
        memoryContext += `${memory.content}\n`;
        if (memory.tags.length > 0) {
          memoryContext += `Теги: ${memory.tags.join(', ')}\n`;
        }
        memoryContext += '\n';
      });

      return memoryContext;
    } catch (error) {
      console.warn('[BrainCoordinator] Ошибка получения контекста из памяти:', error);
      return '';
    }
  }

  async init() {
    if (this.localLLM) {
      await this.localLLM.init();
    }
    
    // Инициализируем менеджер промптов (создает директории)
    if (this.promptManager) {
      await this.promptManager.init();
    }
    
    // Инициализируем память мозга (создает директории)
    if (this.memory) {
      await this.memory.init();
    }
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

    // Мозг НЕ может менять основной промпт, только дописывать подробности
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

    // Если есть правая рука и задача сложная - делегируем ей дописывание подробностей
    if (this.rightHand && this.assessTaskComplexity(context) === 'complex') {
      console.log('[BrainCoordinator] 🧠 Делегирую дописывание подробностей правой руке...');
      const result = await this.rightHand.executeTask(
        `Допиши дополнительные подробности к промпту анализа изображений на основе контекста. НЕ меняй основной промпт, только добавь детали.`,
        { basePrompt, additionalDetails, ...context },
        {
          instructions: 'Добавь только дополнительные детали к промпту, не меняя основную структуру.',
          expectedFormat: 'prompt_addition',
        }
      );
      if (result.success && result.result) {
        const enhancedPrompt = basePrompt + '\n\n' + (result.result || additionalDetails);
        this.promptCache.set(cacheKey, enhancedPrompt);
        return enhancedPrompt;
      }
    }

    // Просто добавляем подробности к основному промпту
    const enhancedPrompt = basePrompt + (additionalDetails ? '\n\n' + additionalDetails : '');
    this.promptCache.set(cacheKey, enhancedPrompt);
    
    // Сохраняем промпт в файл (если он был изменен мозгом)
    if (additionalDetails && this.promptManager) {
      this.promptManager.saveImagePrompt(enhancedPrompt, context).catch(err => {
        console.warn('[BrainCoordinator] Ошибка сохранения промпта:', err.message);
      });
    }
    
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
   */
  async optimizeMessagePrompt(basePrompt, context = {}) {
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

    // Если есть правая рука и задача сложная - делегируем ей
    if (this.rightHand && this.assessTaskComplexity(context) === 'complex') {
      console.log('[BrainCoordinator] 🧠 Делегирую оптимизацию промпта правой руке...');
      const result = await this.rightHand.editPrompt(editablePrompt, 'Генерация сообщений для Twitch чата', {
        ...context,
        instructions: 'Оптимизируй промпт, но НЕ трогай секции про банворды, запрещенные темы и политику - они защищены.',
      });
      if (result.success && result.result) {
        // Восстанавливаем защищенные секции
        let optimizedPrompt = result.result;
        for (const section of protectedSections) {
          optimizedPrompt = optimizedPrompt.replace(`[ЗАЩИЩЕННАЯ СЕКЦИЯ: ${section.type}]`, section.text);
        }
        this.promptCache.set(cacheKey, optimizedPrompt);
        return optimizedPrompt;
      }
    }

    // Получаем историю предыдущих промптов для контекста
    let previousPromptsContext = '';
    if (this.promptManager) {
      const history = await this.promptManager.getPromptHistory('message', 3);
      if (history.length > 0) {
        previousPromptsContext = `\n\nИСТОРИЯ ПРЕДЫДУЩИХ ПРОМПТОВ (для контекста):\n`;
        history.forEach((h, idx) => {
          previousPromptsContext += `\n--- Промпт #${idx + 1} (${new Date(h.timestamp).toLocaleString('ru-RU')}) ---\n${h.prompt.substring(0, 500)}...\n`;
        });
      }
    }

    // Адаптируем промпт под задачу генерации сообщений
    const optimizedPrompt = await this.adaptPromptForTask(
      editablePrompt + previousPromptsContext,
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
    
    // Сохраняем промпт в файл
    if (this.promptManager) {
      this.promptManager.saveMessagePrompt(finalPrompt, context).catch(err => {
        console.warn('[BrainCoordinator] Ошибка сохранения промпта:', err.message);
      });
    }
    
    return finalPrompt;
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
   * Оптимизация промпта для скана сообщений (ChatReader)
   * ВАЖНО: Мозг может трогать полностью
   */
  async optimizeChatReaderPrompt(basePrompt, context = {}) {
    const cacheKey = `chatreader_${basePrompt.substring(0, 50)}`;
    
    if (this.promptCache.has(cacheKey)) {
      return this.promptCache.get(cacheKey);
    }

    // Мозг может полностью редактировать промпт ChatReader
    // Если есть правая рука и задача сложная - делегируем ей
    if (this.rightHand && this.assessTaskComplexity(context) === 'complex') {
      console.log('[BrainCoordinator] 🧠 Делегирую оптимизацию промпта ChatReader правой руке...');
      const result = await this.rightHand.editPrompt(basePrompt, 'Сканирование сообщений Twitch чата', context);
      if (result.success && result.result) {
        // Убеждаемся, что результат - строка
        const promptText = typeof result.result === 'string' ? result.result : (result.result.text || String(result.result));
        this.promptCache.set(cacheKey, promptText);
        return promptText;
      }
    }

    // Адаптируем промпт под задачу сканирования сообщений
    const optimizedPrompt = await this.adaptPromptForTask(
      basePrompt,
      'chat_scanning',
      context
    );

    // Убеждаемся, что optimizedPrompt - строка
    const promptText = typeof optimizedPrompt === 'string' ? optimizedPrompt : (optimizedPrompt?.text || String(optimizedPrompt || basePrompt));

    this.promptCache.set(cacheKey, promptText);
    
    // Сохраняем промпт в файл (мозг может полностью редактировать ChatReader)
    if (this.promptManager) {
      this.promptManager.saveChatReaderPrompt(promptText, context).catch(err => {
        console.warn('[BrainCoordinator] Ошибка сохранения промпта:', err.message);
      });
    }
    
    // Записываем в память информацию об оптимизации промпта ChatReader
    if (this.memory) {
      this.memory.remember(
        `Оптимизирован промпт ChatReader: ${promptText.substring(0, 200)}...`,
        'prompt_optimization',
        { type: 'chatreader', context },
        7,
        ['prompt', 'chatreader', 'optimization']
      ).catch(err => {
        console.warn('[BrainCoordinator] Ошибка записи в память:', err.message);
      });
    }
    
    return promptText;
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
    console.log('[BrainCoordinator] ⚠️ Запрос скриншота от мозга проигнорирован - скриншоты делаются автоматически каждые 10 секунд');
    return null;
    if (!this.browser || !this.coordinator || !this.imageAnalyzer) {
      console.warn('[BrainCoordinator] ⚠️ Модули для запроса скриншотов не установлены');
      return null;
    }

    // БЛОКИРОВКА: если уже идет запрос, не делаем новый
    if (this.state.screenshotRequestInProgress) {
      console.log('[BrainCoordinator] ⏳ Запрос скриншота отклонен: уже идет обработка предыдущего запроса');
      return null;
    }

    const now = Date.now();
    const lastRequest = this.state.lastScreenshotRequest;
    const timeSinceLastRequest = now - lastRequest;

    // Минимальная пауза между запросами - 30 секунд (для экономии денег)
    const minPause = 30000; // 30 секунд
    
    // Максимальное количество запросов в час - 60 (1 запрос в минуту в среднем)
    const maxRequestsPerHour = 60;
    const hourWindow = 60 * 60 * 1000; // 1 час в миллисекундах

    // Сбрасываем счетчик если прошло больше часа
    if (now - this.state.screenshotRequestWindow > hourWindow) {
      this.state.screenshotRequestCount = 0;
      this.state.screenshotRequestWindow = now;
    }

    // Проверяем минимальную паузу
    if (timeSinceLastRequest < minPause) {
      const waitTime = Math.ceil((minPause - timeSinceLastRequest) / 1000);
      console.log(`[BrainCoordinator] ⏳ Запрос скриншота отклонен: минимальная пауза (осталось ${waitTime}с)`);
      return null;
    }

    // Проверяем лимит запросов в час
    if (this.state.screenshotRequestCount >= maxRequestsPerHour) {
      const waitTime = Math.ceil((hourWindow - (now - this.state.screenshotRequestWindow)) / 1000 / 60);
      console.log(`[BrainCoordinator] ⏳ Запрос скриншота отклонен: лимит запросов в час (осталось ~${waitTime} минут)`);
      return null;
    }

    // Мозг сам решает, действительно ли нужен скриншот
    // Проверяем, есть ли уже свежий анализ изображения
    const recentImageAnalysis = context.recentImageAnalysis || [];
    if (recentImageAnalysis.length > 0) {
      const latestAnalysis = recentImageAnalysis[recentImageAnalysis.length - 1];
      const analysisAge = now - (latestAnalysis.timestamp || 0);
      
      // Если есть свежий анализ (менее 10 секунд), возможно не нужен новый
      if (analysisAge < 10000) {
        // Мозг может решить, что нужен новый скриншот только если ситуация изменилась
        const hasNewSpeech = context.speechText && context.speechText.text;
        const hasNewChat = context.chatHistory && context.chatHistory.length > 0;
        
        if (!hasNewSpeech && !hasNewChat) {
          console.log('[BrainCoordinator] ⏳ Запрос скриншота отклонен: есть свежий анализ и нет новых событий');
          return null;
        }
      }
    }

    try {
      // Устанавливаем флаг блокировки
      this.state.screenshotRequestInProgress = true;
      console.log('[BrainCoordinator] 📸 Запрос скриншота от мозга...');
      
      // Делаем скриншот
      const screenshot = await this.browser.takeScreenshot();
      if (!screenshot) {
        console.warn('[BrainCoordinator] ⚠️ Не удалось сделать скриншот');
        this.state.screenshotRequestInProgress = false; // Снимаем блокировку
        return null;
      }

      // Анализируем изображение
      const imageAnalysis = await this.imageAnalyzer.analyzeScreenshot(screenshot.buffer);
      
      if (imageAnalysis && imageAnalysis.description) {
        // Обновляем состояние
        this.state.lastScreenshotRequest = now;
        this.state.screenshotRequestCount++;
        
        // Сохраняем анализ в контекст координатора
        if (this.coordinator && this.coordinator.contextBuffer) {
          this.coordinator.contextBuffer.recentImageAnalysis.push(imageAnalysis);
          if (this.coordinator.contextBuffer.recentImageAnalysis.length > 5) {
            this.coordinator.contextBuffer.recentImageAnalysis.shift();
          }
        }

        console.log(`[BrainCoordinator] ✅ Скриншот получен и проанализирован (запросов в час: ${this.state.screenshotRequestCount}/${maxRequestsPerHour})`);
        
        // Записываем в память информацию о запросе скриншота
        if (this.memory) {
          this.memory.remember(
            `Запрошен скриншот от мозга. Анализ: ${imageAnalysis.description.substring(0, 100)}...`,
            'screenshot_request',
            { timestamp: now, requestCount: this.state.screenshotRequestCount },
            5,
            ['screenshot', 'brain_request']
          ).catch(() => {});
        }
        
        // Снимаем блокировку после успешного завершения
        this.state.screenshotRequestInProgress = false;
        return imageAnalysis;
      }
      
      // Снимаем блокировку если анализ не удался
      this.state.screenshotRequestInProgress = false;
      return null;
    } catch (error) {
      console.error('[BrainCoordinator] ❌ Ошибка при запросе скриншота:', error);
      // Снимаем блокировку при ошибке
      this.state.screenshotRequestInProgress = false;
      return null;
    }
  }

  /**
   * Адаптация промпта под конкретную задачу
   */
  async adaptPromptForTask(basePrompt, taskType, context) {
    if (!this.localLLM) {
      // Если нет локального LLM, возвращаем базовый промпт с улучшениями
      return this.enhancePromptManually(basePrompt, taskType, context);
    }

    try {
      const taskDescription = taskType === 'image_analysis' ? 'Анализ изображений Twitch стрима' : 
                             taskType === 'message_generation' ? 'Генерация сообщений для Twitch чата' :
                             taskType === 'chat_scanning' ? 'Сканирование сообщений Twitch чата' : 'Задача';

      const adaptationPrompt = `Ты МОЗГ бота - чатерс для Twitch стрима. Твоя задача - оптимизировать промпты для лучших результатов.

КТО ТЫ:
- Ты чатерс - бот, который ОБЩАЕТСЯ СО СТРИМЕРОМ через чат
- Ты пишешь сообщения как обычный зритель, не как идеальный бот
- Ты используешь сленг, шутишь, можешь быть пошлым и хамоватым (в меру)
- Ты адаптируешься под стиль конкретного чата и стримера

ГЛАВНАЯ ЗАДАЧА - ОБЩЕНИЕ СО СТРИМЕРОМ:
- Твоя ОСНОВНАЯ цель - ОБЩАТЬСЯ СО СТРИМЕРОМ, отвечать на его речь
- Сообщения генерируются в ОТВЕТ на речь СТРИМЕРА, а не на чат
- Если стример говорит - ОБЯЗАТЕЛЬНО нужно сгенерировать ответ (если уместно)
- Реагируй на слова стримера: отвечай на вопросы, комментируй, поддерживай разговор

РОЛЬ ЧАТА (ВАЖНО!):
- Чат используется ТОЛЬКО для ОБУЧЕНИЯ стилю и подстройки под аудиторию
- Извлекай из чата сленг, мемы, стиль общения - чтобы подстроиться
- НЕ генерируй сообщения в ответ на чат (если стример не говорит)
- Чат - это КОНТЕКСТ для подстройки, НЕ источник для ответов
- Твоя цель - общаться со СТРИМЕРОМ, а не с чатом

ТВОЯ РОЛЬ:
- В ОСНОВНОМ РЕЖИМЕ: ты работаешь как чатерс, ОБЩАЕШЬСЯ СО СТРИМЕРОМ
- В РЕЖИМЕ ОБУЧЕНИЯ: ты анализируешь сообщения из чата, учишься стилю и доводишь свои промпты до идеала
- Ты можешь дополнять и улучшать промпты на основе опыта
- Ты учитываешь предыдущие промпты и их эффективность

ВОЗМОЖНОСТИ МОЗГА:
- Полная свобода в принятии решений
- Можешь редактировать промпты (кроме защищенных секций)
- Можешь экспериментировать и пробовать новые подходы
- Используй память и контекст для улучшения промптов
- Можешь дополнять промпты новыми инструкциями на основе опыта
- Скриншоты делаются автоматически каждые 10 секунд, ты не можешь запрашивать их самостоятельно

ОГРАНИЧЕНИЯ МОЗГА:
- НЕ трогай защищенные секции (банворды Twitch для генератора сообщений)
- Избегай запрещенных тем (экстремизм, насилие, дискриминация)
- Избегай политических тем (политика, выборы, партии)

ЗАДАЧА: ${taskDescription}

КОНТЕКСТ:
${JSON.stringify(context, null, 2)}

БАЗОВЫЙ ПРОМПТ:
${basePrompt}

КРИТИЧЕСКИ ВАЖНО - ЧТО ТЫ ДОЛЖЕН ВЕРНУТЬ:
- Ты должен вернуть ГОТОВЫЙ ПРОМПТ для LLM (нейронной сети)
- Это НЕ техническое описание, НЕ инструкция для программиста, НЕ документация
- Это ПРЯМАЯ ИНСТРУКЦИЯ для нейронной сети, которая будет выполнять задачу
- Промпт должен начинаться с "Ты..." или "Твоя задача..." и содержать четкие инструкции
- Промпт должен быть на русском языке (если задача на русском)
- Промпт должен быть структурированным и понятным для LLM

ОПТИМИЗИРУЙ промпт так, чтобы:
1. Сохранить все важные инструкции из базового промпта
2. Улучшить ясность и структуру для LLM
3. Добавить конкретные примеры если нужно
4. Адаптировать под контекст задачи
5. Использовать полную свободу для улучшения результатов
6. Учесть опыт предыдущих промптов (если они есть в контексте)
7. Сделать промпт максимально эффективным для выполнения задачи

ВАЖНО О СКРИНШОТАХ:
- Скриншоты делаются автоматически каждые 10 секунд
- Ты НЕ можешь запрашивать скриншоты самостоятельно
- Используй уже имеющиеся анализы изображений из контекста

Верни ТОЛЬКО готовый промпт для LLM, без дополнительных объяснений, без технических описаний, без мета-комментариев. Промпт должен быть готов к использованию.`;

      const optimized = await this.localLLM.generate(
        adaptationPrompt,
        'Ты эксперт по промптам. Оптимизируй промпт для лучших результатов.',
        { temperature: 0.3, max_tokens: 2000 }
      );

      // localLLM.generate возвращает объект с полем text
      const optimizedText = (optimized && typeof optimized === 'object' ? optimized.text : optimized) || basePrompt;
      return optimizedText;
    } catch (error) {
      console.warn('[BrainCoordinator] Ошибка оптимизации промпта, используем базовый:', error.message);
      return this.enhancePromptManually(basePrompt, taskType, context);
    }
  }

  /**
   * Ручное улучшение промпта (fallback)
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
   * @param {number} currentTime - текущее время (timestamp)
   * @param {Object} context - контекст стрима
   * @returns {Object} - решение о необходимости ожидания
   */
  updateTime(currentTime, context = {}) {
    const now = currentTime || Date.now();
    const lastMessageTime = this.state.lastMessageTime || 0;
    const timeSinceLastMessage = now - lastMessageTime;
    
    // Минимальная пауза между сообщениями - 10 секунд
    const minPause = 10000;
    
    if (timeSinceLastMessage < minPause) {
      return {
        shouldWait: true,
        reason: 'Минимальная пауза между сообщениями',
        timeRemaining: minPause - timeSinceLastMessage,
      };
    }
    
    // Если нет интересных событий - увеличиваем паузу до 30 секунд
    const hasInterestingEvents = 
      (context.imageAnalysis && context.imageAnalysis.confidence > 0.8) ||
      (context.speechText && context.speechText.text && context.speechText.text.length > 10) ||
      (context.chatHistory && context.chatHistory.length > 0);
    
    if (!hasInterestingEvents && timeSinceLastMessage < 30000) {
      return {
        shouldWait: true,
        reason: 'Нет интересных событий, увеличиваем паузу',
        timeRemaining: 30000 - timeSinceLastMessage,
      };
    }
    
    return {
      shouldWait: false,
      reason: 'Можно генерировать сообщение',
      timeRemaining: 0,
    };
  }

  /**
   * Установка времени последнего сообщения
   */
  setLastMessageTime(timestamp) {
    this.state.lastMessageTime = timestamp || Date.now();
  }

  /**
   * Определение сложности задачи
   */
  assessTaskComplexity(context) {
    let complexity = 'simple';
    let score = 0;

    // Анализ изображения
    if (context.imageAnalysis && context.imageAnalysis.description) {
      const descLength = context.imageAnalysis.description.length;
      if (descLength > 500) score += 1;
      if (descLength > 1000) score += 1;
    }

    // Речь
    if (context.speechText && context.speechText.text) {
      score += 1;
      if (context.speechText.text.length > 50) score += 1;
    }

    // История чата
    if (context.chatHistory && context.chatHistory.length > 5) {
      score += 1;
    }

    // Множественные говорящие
    if (context.recentSpeakers && context.recentSpeakers.length > 2) {
      score += 1;
    }

    if (score >= 3) complexity = 'complex';
    else if (score >= 2) complexity = 'medium';

    return complexity;
  }

  /**
   * Решение: нужен ли помощник мозга для сложной задачи
   */
  shouldUseBrainAssistant(context) {
    const complexity = this.assessTaskComplexity(context);
    return complexity === 'complex';
  }

  /**
   * Решение мозга: отвечать ли на интересное сообщение из чата
   * @param {Object} interestingMessage - интересное сообщение от ChatReader
   * @param {Object} context - текущий контекст стрима
   * @returns {Object} - решение мозга
   */
  async decideOnChatMessage(interestingMessage, context = {}) {
    // Проверяем время - мозг понимает когда можно отвечать
    const timeCheck = this.updateTime(Date.now(), context);
    if (timeCheck.shouldWait) {
      return {
        shouldRespond: false,
        reason: timeCheck.reason,
        waitTime: timeCheck.timeRemaining,
      };
    }

    // Если есть правая рука - можем делегировать анализ
    if (this.rightHand) {
      const analysis = await this.rightHand.executeTask(
        `Проанализируй интересное сообщение из чата и реши, стоит ли на него отвечать: "${interestingMessage.message}" от ${interestingMessage.username}`,
        { interestingMessage, ...context },
        {
          instructions: 'Оцени уместность ответа, интересность сообщения, контекст стрима.',
          expectedFormat: 'decision',
        }
      );

      if (analysis.success && analysis.result) {
        // Парсим решение от правой руки
        const lowerResult = analysis.result.toLowerCase();
        const shouldRespond = !lowerResult.includes('не стоит') && 
                             !lowerResult.includes('не нужно') &&
                             !lowerResult.includes('не отвечать');
        
        return {
          shouldRespond,
          reason: analysis.result,
          confidence: shouldRespond ? 0.7 : 0.3,
        };
      }
    }

    // Простое решение без правой руки
    const hasQuestion = interestingMessage.message.includes('?');
    const hasInterestingWords = ['почему', 'как', 'что', 'интересно'].some(word => 
      interestingMessage.message.toLowerCase().includes(word)
    );

    return {
      shouldRespond: hasQuestion || hasInterestingWords,
      reason: hasQuestion ? 'Содержит вопрос' : hasInterestingWords ? 'Интересный комментарий' : 'Недостаточно интересно',
      confidence: hasQuestion ? 0.8 : 0.5,
    };
  }
}
