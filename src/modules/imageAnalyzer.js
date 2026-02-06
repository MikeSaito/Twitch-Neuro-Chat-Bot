import axios from 'axios';

export class ImageAnalyzer {
  constructor(config = {}) {
    this.apiKey = config.apiKey || '';
    this.useProxyAPI = config.useProxyAPI || false;
    this.proxyAPIKey = config.proxyAPIKey || '';
    this.proxyAPIBaseUrl = config.proxyAPIBaseUrl || 'https://api.proxyapi.ru';
    this.proxyAPIProvider = config.proxyAPIProvider || 'google';
    this.proxyAPIVisionModel = config.proxyAPIVisionModel || 'gemini-2.5-flash-lite';
    
    this.brainCoordinator = null; // Связь с мозгом для оптимизации промптов
    
    // Кэш для артефактов распознавания речи (Set для быстрого поиска)
    this.speechArtifacts = new Set([
      'максимум', 'максима', 'максим',
      'звук', 'звуки', 'шум', 'шумов',
      'тишина', 'молчание', 'пауза',
      'неразборчиво', 'непонятно',
    ]);
  }
  
  /**
   * Фильтрация артефактов распознавания речи
   */
  filterSpeechArtifacts(text) {
    if (!text || text.length < 2) return false;
    
    const lowerText = text.toLowerCase();
    
    // Проверяем точное совпадение или начало с артефакта
    for (const artifact of this.speechArtifacts) {
      if (lowerText === artifact || lowerText.startsWith(artifact + ' ')) {
        return false;
      }
    }
    
    // Если текст слишком короткий и содержит артефакт
    if (text.length < 5) {
      for (const artifact of this.speechArtifacts) {
        if (lowerText.includes(artifact)) {
          return false;
        }
      }
    }
    
    return true;
  }

  async init() {
    if (this.useProxyAPI) {
      // Используем прямой HTTP запрос к ProxyAPI
      console.log(`[ImageAnalyzer] Используется ProxyAPI для Gemini (прямой HTTP запрос)`);
      console.log(`[ImageAnalyzer] Модель: ${this.proxyAPIVisionModel}`);
    } else {
      console.log(`[ImageAnalyzer] Используется OpenAI Vision API`);
    }
  }

  async analyzeScreenshot(imageBuffer) {
    if (!imageBuffer || imageBuffer.length === 0) {
      return {
        description: '',
        confidence: 0,
        timestamp: Date.now(),
      };
    }

    try {
      let description = '';
      let confidence = 0.8;

      // Получаем контекст для промпта (речь, чат и т.д.)
      // Если есть brainCoordinator, он может предоставить дополнительный контекст
      const promptContext = {
        time: Date.now(),
        recentSpeakers: [],
        chatHistory: [],
        realtimeSpeechText: null,
        recentSpeechFragments: [],
      };
      
      // Если есть brainCoordinator, получаем дополнительный контекст
      if (this.brainCoordinator) {
        // Получаем накопительный текст речи
        if (this.brainCoordinator.getCurrentSpeechText) {
          promptContext.realtimeSpeechText = this.brainCoordinator.getCurrentSpeechText(30); // Последние 30 секунд
        }
        if (this.brainCoordinator.getRecentSpeechFragments) {
          promptContext.recentSpeechFragments = this.brainCoordinator.getRecentSpeechFragments(5);
        }
      }
      
      if (this.useProxyAPI) {
        // Анализ через ProxyAPI (прямой HTTP запрос)
        const base64Image = imageBuffer.toString('base64');
        const prompt = await this.getImageAnalysisPrompt(promptContext);
        
        try {
          // Используем прямой HTTP запрос к ProxyAPI для Gemini
          const response = await axios.post(
            `${this.proxyAPIBaseUrl}/google/v1beta/models/${this.proxyAPIVisionModel}:generateContent`,
            {
              contents: [{
                parts: [
                  {
                    inlineData: {
                      mimeType: 'image/jpeg',
                      data: base64Image,
                    },
                  },
                  { text: prompt },
                ],
              }],
            },
            {
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.proxyAPIKey}`,
              },
              timeout: 60000, // 60 секунд для анализа изображений
            }
          );

          description = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
          if (!description && response.data?.text) {
            description = response.data.text;
          }
          confidence = 1.0;
        } catch (error) {
          if (error.response?.status === 404) {
            console.error(`[ImageAnalyzer] 🔑 ВОЗМОЖНАЯ ПРИЧИНА: Неверный или отсутствующий API ключ ProxyAPI`);
            console.error(`[ImageAnalyzer]    Проверьте PROXYAPI_KEY в .env файле`);
            throw error;
          } else if (error.response?.status === 402) {
            console.error(`[ImageAnalyzer] 💰 Недостаточно средств на балансе ProxyAPI`);
            throw error;
          } else if (error.response?.status === 403) {
            console.error(`[ImageAnalyzer] 🚫 Доступ запрещен. Проверьте API ключ ProxyAPI`);
            throw error;
          } else {
            throw error;
          }
        }
      } else {
        throw new Error('OpenAI Vision API не реализован');
      }

      return {
        description: description.trim(),
        confidence: confidence,
        timestamp: Date.now(),
      };
    } catch (error) {
      console.error(`[ImageAnalyzer] Ошибка анализа изображения:`, error.message);
      return {
        description: '',
        confidence: 0,
        timestamp: Date.now(),
        error: error.message,
      };
    }
  }

  async getImageAnalysisPrompt(context = {}) {
    // Базовый промпт для анализа изображения
    // Мозг может его оптимизировать через brainCoordinator
    let prompt = `Проанализируй скриншот Twitch стрима и опиши что происходит. 

ВАЖНО - Опиши:
0. ИНФОРМАЦИЯ О СТРИМЕ (ВАЖНО!):
   - Название стрима (stream title)
   - Категория игры (game category)
   - Имя стримера
   - Количество зрителей (если видно)
   - Вся видимая информация на экране

1. Что происходит в игре/на стриме (главное действие)
2. Эмоции стримера/игрока (если видно лицо)
3. Важные элементы интерфейса игры
4. Любые интересные детали

Опиши кратко, но информативно на русском языке.`;

    // Если есть brainCoordinator, он может оптимизировать промпт и добавить вопросы
    if (this.brainCoordinator) {
      try {
        prompt = await this.brainCoordinator.optimizeImagePrompt(prompt, context);
      } catch (error) {
        console.warn('[ImageAnalyzer] Ошибка оптимизации промпта мозгом:', error.message);
        // Продолжаем с базовым промптом
      }
    }

    return prompt;
  }

  /**
   * Генерация сообщения для чата напрямую через Gemini на основе скриншота
   * ИМБА: Gemini видит стрим и сразу генерирует сообщение!
   */
  async generateChatMessageFromScreenshot(imageBuffer, context = {}) {
    if (!this.useProxyAPI || !imageBuffer) {
      return null;
    }

    try {
      const {
        speechText = null,
        recentSpeechFragments = [],
        chatHistory = [],
        streamContext = {},
        botUsername = 'медвед12sensei',
        isFirstMessage = false,
        sessionHistory = null, // История сессии
      } = context;

      // Формируем контекст речи
      let speechContext = '';
      
      // Сначала проверяем recentSpeechFragments (реалтайм речь)
      if (recentSpeechFragments && recentSpeechFragments.length > 0) {
        // Берем фрагменты стримера (по isStreamer или по префиксу [СТРИМЕР])
        // Оптимизировано: объединяем filter/map/filter в один проход
        const streamerFragments = [];
        const prefixRegex = /^\[(?:СТРИМЕР|ГОСТЬ)\]\s*/;
        
        for (let i = recentSpeechFragments.length - 1; i >= 0 && streamerFragments.length < 5; i--) {
          const f = recentSpeechFragments[i];
          
          // Проверяем isStreamer или наличие префикса [СТРИМЕР] в тексте
          if (f.isStreamer === true || (f.text && f.text.includes('[СТРИМЕР]'))) {
            const text = (f.text || '').replace(prefixRegex, '').trim();
            
            // Фильтруем артефакты распознавания речи
            if (this.filterSpeechArtifacts(text)) {
              streamerFragments.unshift(text);
            } else {
              console.log(`[ImageAnalyzer] ⚠️ Отфильтрован артефакт распознавания: "${text}"`);
            }
          }
        }
        
        if (streamerFragments.length > 0) {
          speechContext = `\nРЕЧЬ СТРИМЕРА (последние фрагменты):\n${streamerFragments.join('\n')}\n`;
          console.log(`[ImageAnalyzer] 📢 Используем реалтайм речь стримера: ${streamerFragments.length} фрагментов`);
        } else {
          // Если нет фрагментов стримера, берем все фрагменты (может быть только речь гостей)
          // Оптимизировано: объединяем map/filter в один проход
          const allFragments = [];
          const prefixRegex = /^\[(?:СТРИМЕР|ГОСТЬ)\]\s*/;
          
          for (let i = recentSpeechFragments.length - 1; i >= 0 && allFragments.length < 5; i--) {
            const f = recentSpeechFragments[i];
            const text = (f.text || '').replace(prefixRegex, '').trim();
            
            // Фильтруем артефакты (кроме "молчание", "тишина", "пауза" - это может быть реальная речь)
            if (text && text.length >= 2) {
              const lowerText = text.toLowerCase();
              const isArtifact = lowerText === 'неразборчиво' || lowerText === 'непонятно' ||
                lowerText === 'максимум' || lowerText === 'максима' || lowerText === 'максим' ||
                lowerText === 'звук' || lowerText === 'звуки' || lowerText === 'шум' || lowerText === 'шумов' ||
                (text.length < 5 && (lowerText.includes('максим') || lowerText.includes('звук') || lowerText.includes('шум')));
              
              if (!isArtifact) {
                allFragments.unshift(text);
              } else {
                console.log(`[ImageAnalyzer] ⚠️ Отфильтрован артефакт распознавания: "${text}"`);
              }
            }
          }
          
          if (allFragments.length > 0) {
            speechContext = `\nРЕЧЬ (последние фрагменты):\n${allFragments.join('\n')}\n`;
            console.log(`[ImageAnalyzer] 📢 Используем реалтайм речь (все фрагменты): ${allFragments.length} фрагментов`);
          }
        }
      }
      
      // Если нет реалтайм речи, используем speechText
      if (!speechContext && speechText && speechText.text) {
        const speechTextClean = speechText.text.trim();
        if (speechTextClean && speechTextClean !== 'молчание') {
          speechContext = `\nРЕЧЬ СТРИМЕРА:\n${speechTextClean}\n`;
          console.log(`[ImageAnalyzer] 📢 Используем speechText: "${speechTextClean.substring(0, 50)}..."`);
        }
      }
      
      // Если все еще нет речи, выводим предупреждение
      if (!speechContext) {
        console.log(`[ImageAnalyzer] ⚠️ Речь не передана в контекст. recentSpeechFragments: ${recentSpeechFragments?.length || 0}, speechText: ${speechText?.text ? 'есть' : 'нет'}`);
      }

      // Получаем историю сессии для контекста
      let historyContext = '';
      if (sessionHistory && typeof sessionHistory.getHistoryContext === 'function') {
        historyContext = sessionHistory.getHistoryContext(10, 5, 5); // Последние 10 речи, 5 событий, 5 сообщений
      }

      // Упрощенный промпт - одна нейронка получает инструкцию, изображение, речь и историю
      const prompt = `Ты собеседник стримера в Twitch чате. Твое имя: ${botUsername}.

СТИЛЬ ОБЩЕНИЯ:
- Пиши ТОЛЬКО на РУССКОМ языке
- Сообщения короткие: 5-50 символов (ОБЯЗАТЕЛЬНО!)
- Будь НЕФОРМАЛЬНЫМ и ЧЕЛОВЕЧНЫМ - пиши как обычный человек в чате, не как бот!
- Используй разговорный стиль, сленг, сокращения (если уместно)
- Будь естественным - не пытайся быть слишком умным или формальным
- Реагируй на события как обычный зритель - эмоционально, но естественно
- Будь РАЗНООБРАЗНЫМ - не повторяйся! Каждое сообщение должно быть уникальным
- Используй разные формулировки, разные реакции, разные эмоции

ПРАВИЛА:
- Верни "null" ТОЛЬКО если хочешь промолчать В остальных случаях ВСЕГДА пиши сообщение - комментируй, реагируй, шути!
- Помни предыдущие события - используй историю для контекста
- ЗАПРЕЩЕНО использовать обычные эмодзи (👋, 😂, 😊, 🎉 и т.д.) - ТОЛЬКО 7TV эмодзи разрешены!
- ПУНКТУАЦИЯ ЗАПРЕЩЕНА! НЕ используй точки, запятые, восклицательные знаки, вопросительные знаки, двоеточия, тире и любую другую пунктуацию! Пиши БЕЗ пунктуации вообще!
- НЕ задавай вопросы постоянно! Используй вопросы изредка, чаще пиши утверждения и комментарии
- НЕ повторяй предыдущие сообщения - будь разнообразным!
- НЕ пиши многострочные сообщения - только ОДНА строка!
- НЕ используй префиксы типа "nextlevel:", "username:" и т.д. - пиши просто текст!

${historyContext}${speechContext}

Смотри на скриншот стрима и реагируй на события, комментируй, шути. Будь собеседником стримера. 

ВАЖНО: 
- Будь РАЗНООБРАЗНЫМ - каждое сообщение должно быть уникальным! Не повторяйся!
- Будь НЕФОРМАЛЬНЫМ и ЧЕЛОВЕЧНЫМ - пиши как обычный человек, не как бот!
- Не задавай вопросы постоянно - чаще пиши утверждения и комментарии
- Реагируй на речь стримера, если она есть в контексте
- Используй разные формулировки, разные реакции, разные эмоции
- Верни "null" ТОЛЬКО если скриншот полностью черный/пустой или стрим не запущен. В остальных случаях ВСЕГДА пиши сообщение - комментируй, реагируй, шути!`;

      // Отправляем запрос к Gemini с изображением и промптом
      const base64Image = imageBuffer.toString('base64');
      const response = await axios.post(
        `${this.proxyAPIBaseUrl}/google/v1beta/models/${this.proxyAPIVisionModel}:generateContent`,
        {
          contents: [{
            parts: [
              {
                inlineData: {
                  mimeType: 'image/jpeg',
                  data: base64Image,
                },
              },
              { text: prompt },
            ],
          }],
          generationConfig: {
            temperature: 0.8,
            topP: 0.9,
            topK: 40,
            maxOutputTokens: 50, // Короткие сообщения
          },
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.proxyAPIKey}`,
          },
          timeout: 60000,
        }
      );

      let generatedText = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      
      if (!generatedText) {
        return null;
      }

      // Очищаем от лишних пробелов
      generatedText = generatedText.trim();
      
      // Если ответ "null" (в любом регистре) - молчим
      if (generatedText.toLowerCase() === 'null') {
        return null;
      }
      
      // Убираем "null" в конце сообщения, если оно есть
      generatedText = generatedText.replace(/\s+null\s*$/i, '').trim();
      
      // УДАЛЯЕМ ОБЫЧНЫЕ ЭМОДЗИ (Unicode эмодзи) - разрешены только 7TV эмодзи
      const emojiPattern = /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F600}-\u{1F64F}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{1F900}-\u{1F9FF}]|[\u{1FA00}-\u{1FA6F}]|[\u{1FA70}-\u{1FAFF}]/gu;
      const emojiCount = (generatedText.match(emojiPattern) || []).length;
      if (emojiCount > 0) {
        console.log(`[ImageAnalyzer] ⚠️ Сообщение содержит обычные эмодзи (${emojiCount} шт.), удаляем`);
        generatedText = generatedText.replace(emojiPattern, '').trim();
      }
      
      // Удаляем префиксы типа "Я:", "Бот:", "[БОТ]", "nextlevel:", "username:" и т.д.
      generatedText = generatedText.replace(/^(?:\[?БОТ\]?|Я:|Бот:|Bot:)\s*/i, '').trim();
      // Удаляем префиксы типа "nextlevel:", "username:", "nickname:" и т.д.
      generatedText = generatedText.replace(/^[a-z0-9_]+:\s*/i, '').trim();
      
      // Удаляем markdown форматирование
      generatedText = generatedText.replace(/\*\*([^*]+)\*\*/g, '$1');
      generatedText = generatedText.replace(/\*([^*]+)\*/g, '$1');
      generatedText = generatedText.replace(/__([^_]+)__/g, '$1');
      generatedText = generatedText.replace(/_([^_]+)_/g, '$1');
      
      // Удаляем кавычки в начале и конце
      generatedText = generatedText.replace(/^["'«»]|["'«»]$/g, '').trim();
      
      // Обрабатываем многострочные сообщения - оставляем только первую строку
      if (generatedText.includes('\n')) {
        const firstLine = generatedText.split('\n')[0].trim();
        console.log(`[ImageAnalyzer] ⚠️ Сообщение многострочное, оставляем только первую строку: "${firstLine}"`);
        generatedText = firstLine;
      }
      
      // УДАЛЯЕМ ВСЮ ПУНКТУАЦИЮ - жесткий запрет на пунктуацию
      // Удаляем все знаки препинания: точки, запятые, восклицательные, вопросительные, двоеточия, тире и т.д.
      generatedText = generatedText.replace(/[.,!?:;—–\-]/g, '').trim();
      
      // Ограничиваем длину сообщения до 50 символов
      if (generatedText.length > 50) {
        console.log(`[ImageAnalyzer] ⚠️ Сообщение слишком длинное (${generatedText.length} символов), обрезаем до 50`);
        generatedText = generatedText.substring(0, 50).trim();
        // Удаляем обрезанное слово в конце, если оно неполное
        const lastSpace = generatedText.lastIndexOf(' ');
        if (lastSpace > 30) {
          generatedText = generatedText.substring(0, lastSpace).trim();
        }
      }
      
      // Фильтруем повторяющиеся слова/фразы (например, "GEGE GEGE GEGE")
      const words = generatedText.split(/\s+/);
      if (words.length > 2) {
        // Проверяем, есть ли повторяющиеся слова подряд
        let repeatedCount = 0;
        let lastWord = '';
        for (const word of words) {
          if (word.toLowerCase() === lastWord.toLowerCase()) {
            repeatedCount++;
            if (repeatedCount >= 2) {
              // Если одно слово повторяется 3+ раза подряд - это мусор
              console.log(`[ImageAnalyzer] ⚠️ Отфильтровано сообщение с повторяющимися словами: "${generatedText}"`);
              return null;
            }
          } else {
            repeatedCount = 0;
          }
          lastWord = word;
        }
        
        // Проверяем общее количество уникальных слов
        const uniqueWords = new Set(words.map(w => w.toLowerCase()));
        if (uniqueWords.size < words.length * 0.3 && words.length > 3) {
          // Если уникальных слов меньше 30% от общего количества - это повторения
          console.log(`[ImageAnalyzer] ⚠️ Отфильтровано сообщение с множественными повторениями: "${generatedText}"`);
          return null;
        }
      }
      
      // Если после очистки ничего не осталось - молчим
      if (!generatedText || generatedText.length < 2) {
        return null;
      }

      return {
        text: generatedText,
        confidence: 0.9,
        timestamp: Date.now(),
        source: 'gemini_direct',
      };
    } catch (error) {
      console.error(`[ImageAnalyzer] Ошибка генерации сообщения через Gemini:`, error.message);
      return null;
    }
  }
}
