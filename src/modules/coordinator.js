export class Coordinator {
  constructor(config, modules) {
    this.config = config;
    this.modules = modules;
    this.state = {
      isActive: true,
      silenceMode: false,
      lastMessageTime: 0,
      // messageCooldown убран - мозг сам решает через brainCoordinator.updateTime()
      totalMessages: 0,
      skippedMessages: 0,
    };
    this.contextBuffer = {
      recentImageAnalysis: [],
      recentSpeechText: [],
      chatHistory: [],
    };
  }

  /**
   * Обработка только голоса/аудио (независимо от обработки изображений)
   * Вызывается каждые 5 секунд для постоянного распознавания речи
   */
  async processAudioOnly(audioBuffer) {
    if (!this.state.isActive) {
      return;
    }

    if (!audioBuffer || audioBuffer.length === 0) {
      console.log('[Coordinator] 🎤 Нет аудио данных для обработки');
      return;
    }

    try {
      console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('[Coordinator] 🎤 ОБРАБОТКА ГОЛОСА: Начало');
      console.log(`[Coordinator] 🎤 Размер аудио буфера: ${audioBuffer.length} байт`);
      
      // Распознавание речи
      console.log('[Coordinator] 🎤 Шаг 1: Распознавание речи...');
      let speechText = await this.modules.speechRecognizer.recognizeFromStream(audioBuffer);
      
      // Если речь не распознана - создаем объект "молчание" и продолжаем обработку
      if (!speechText || !speechText.text) {
        console.log('[Coordinator] ⚠️ Речь не распознана - записываем как "молчание"');
        speechText = {
          text: 'молчание',
          confidence: 0.1,
          timestamp: Date.now(),
          isSilence: true, // Флаг что это молчание, а не реальная речь
        };
      } else {
        console.log(`[Coordinator] ✅ Речь распознана: "${speechText.text}"`);
      }
      
      // Идентификация говорящего (пропускаем для молчания)
      let voiceIdentification = null;
      if (!speechText.isSilence) {
        const currentImageAnalysis = this.contextBuffer.recentImageAnalysis[this.contextBuffer.recentImageAnalysis.length - 1] || null;
        
        console.log('[Coordinator] 🧠 Шаг 2: Идентификация говорящего...');
        voiceIdentification = await this.modules.voiceIdentifier.identifySpeaker(
          speechText,
          currentImageAnalysis
        );
        
        console.log(`[Coordinator] 🧠 РЕЗУЛЬТАТ ИДЕНТИФИКАЦИИ:`);
        if (voiceIdentification.speaker !== 'unknown') {
          const speakerName = voiceIdentification.name || voiceIdentification.speaker;
          const action = voiceIdentification.shouldIgnore ? '🚫 ИГНОРИРУЕТ' : '✅ ОБРАБАТЫВАЕТ';
          console.log(`[Coordinator]    ${action} речь от: ${speakerName}`);
          console.log(`[Coordinator]    Тип: ${voiceIdentification.type}`);
          console.log(`[Coordinator]    Уверенность: ${(voiceIdentification.confidence * 100).toFixed(1)}%`);
          
          if (voiceIdentification.isNewVoice) {
            console.log(`[Coordinator]    🎤 Обнаружен новый голос! Запоминаю...`);
          }
        } else {
          console.log(`[Coordinator]    ⚠️ Говорящий не определен`);
        }
        
        // Добавляем информацию о говорящем к данным речи
        speechText.speaker = voiceIdentification.speaker;
        speechText.isStreamer = voiceIdentification.isStreamer;
        speechText.shouldIgnore = voiceIdentification.shouldIgnore;
        speechText.speakerName = voiceIdentification.name;
        speechText.voiceType = voiceIdentification.type;
        speechText.speakerId = voiceIdentification.speaker;
      } else {
        // Для молчания устанавливаем значения по умолчанию
        console.log('[Coordinator] 🧠 Шаг 2: Молчание - пропускаем идентификацию');
        speechText.speaker = 'unknown';
        speechText.isStreamer = false;
        speechText.shouldIgnore = false; // Молчание не игнорируем - это важная информация
        speechText.speakerName = 'молчание';
        speechText.voiceType = 'silence';
        speechText.speakerId = 'silence';
        voiceIdentification = {
          speaker: 'silence',
          isStreamer: false,
          shouldIgnore: false,
          name: 'молчание',
          type: 'silence',
          confidence: 0.1,
        };
      }
      
      // Сохраняем речь всех людей (стримера и гостей), но НЕ донаты
      // Если идентификация не удалась (unknown), но это не донат - все равно обрабатываем
      if (!voiceIdentification.shouldIgnore) {
        this.contextBuffer.recentSpeechText.push(speechText);
        if (this.contextBuffer.recentSpeechText.length > 5) {
          this.contextBuffer.recentSpeechText.shift();
        }
        const speakerName = voiceIdentification.name || voiceIdentification.speaker || 'неизвестный';
        console.log(`[Coordinator] ✅ Речь сохранена в контекст: ${speakerName}`);
        
        // Сохраняем речь для обучения
        if (this.modules.dataCollector && this.modules.dataCollector.enabled) {
          this.modules.dataCollector.saveSpeech(speechText).catch(() => {});
        }
      } else {
        console.log(`[Coordinator] 🚫 Речь пропущена: ${voiceIdentification.reason || 'донат/TTS'}`);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        return;
      }
      
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    } catch (error) {
      console.error('[Coordinator] Ошибка обработки аудио:', error);
    }
  }

  /**
   * Обработка только изображения (независимо от генерации сообщений)
   * Вызывается каждые 5 секунд для постоянного анализа скриншотов
   */
  async processImageOnly(screenshot, audioData = null) {
    if (!this.state.isActive) {
      return;
    }

    try {
      // Анализ изображения (параллельно, не блокируя генерацию сообщений)
      console.log(`[Coordinator] 📸 Обработка скриншота #${screenshot.timestamp}...`);
      const imageAnalysis = await this.modules.imageAnalyzer.analyzeScreenshot(
        screenshot.buffer
      );

      if (imageAnalysis.description) {
        this.contextBuffer.recentImageAnalysis.push(imageAnalysis);
        // Храним только последние 5 анализов (больше для лучшего контекста)
        if (this.contextBuffer.recentImageAnalysis.length > 5) {
          this.contextBuffer.recentImageAnalysis.shift();
        }
        console.log(`[Coordinator] ✅ Скриншот #${screenshot.timestamp} обработан и сохранен`);
      } else {
        console.log(`[Coordinator] ⚠️ Скриншот #${screenshot.timestamp} не обработан`);
      }

      // Распознавание речи (если есть аудио)
      if (audioData) {
        console.log(`[Coordinator] 🎤 Распознавание речи для скриншота #${screenshot.timestamp}...`);
        let speechText = await this.modules.speechRecognizer.recognizeFromStream(audioData);
        
        // Если речь не распознана - создаем объект "молчание" и продолжаем обработку
        if (!speechText || !speechText.text) {
          console.log(`[Coordinator] ⚠️ Речь не распознана для скриншота #${screenshot.timestamp} - записываем как "молчание"`);
          speechText = {
            text: 'молчание',
            confidence: 0.1,
            timestamp: Date.now(),
            isSilence: true, // Флаг что это молчание, а не реальная речь
          };
        }
        
        if (speechText) {
          // Идентификация говорящего (пропускаем для молчания)
          let voiceIdentification = null;
          if (!speechText.isSilence) {
            const currentImageAnalysis = this.contextBuffer.recentImageAnalysis[this.contextBuffer.recentImageAnalysis.length - 1] || imageAnalysis;
            
            voiceIdentification = await this.modules.voiceIdentifier.identifySpeaker(
              speechText,
              currentImageAnalysis,
              audioData // Передаем аудио буфер для локального анализа
            );
            
            // Добавляем информацию о говорящем к данным речи
            speechText.speaker = voiceIdentification.speaker;
            speechText.isStreamer = voiceIdentification.isStreamer;
            speechText.shouldIgnore = voiceIdentification.shouldIgnore;
            speechText.speakerName = voiceIdentification.name;
            speechText.voiceType = voiceIdentification.type;
            speechText.speakerId = voiceIdentification.speaker;
          } else {
            // Для молчания устанавливаем значения по умолчанию
            speechText.speaker = 'unknown';
            speechText.isStreamer = false;
            speechText.shouldIgnore = false; // Молчание не игнорируем - это важная информация
            speechText.speakerName = 'молчание';
            speechText.voiceType = 'silence';
            speechText.speakerId = 'silence';
            voiceIdentification = {
              speaker: 'silence',
              isStreamer: false,
              shouldIgnore: false,
              name: 'молчание',
              type: 'silence',
              confidence: 0.1,
            };
          }
          
          // Сохраняем речь всех людей (стримера и гостей), но НЕ донаты
          // Также сохраняем "молчание" для контекста
          if (!voiceIdentification.shouldIgnore || speechText.isSilence) {
            this.contextBuffer.recentSpeechText.push(speechText);
            if (this.contextBuffer.recentSpeechText.length > 5) {
              this.contextBuffer.recentSpeechText.shift();
            }
            
            if (speechText.isSilence) {
              console.log(`[Coordinator] ✅ Молчание сохранено для скриншота #${screenshot.timestamp}`);
            } else {
              console.log(`[Coordinator] ✅ Речь сохранена: ${voiceIdentification.name || voiceIdentification.speaker}`);
            }
            
            // Сохраняем речь для обучения (но не молчание)
            if (!speechText.isSilence && this.modules.dataCollector && this.modules.dataCollector.enabled) {
              this.modules.dataCollector.saveSpeech(speechText).catch(() => {});
            }
          }
        }
      }
    } catch (error) {
      console.error(`[Coordinator] Ошибка обработки скриншота #${screenshot.timestamp}:`, error);
    }
  }

  /**
   * Генерация сообщения на основе уже обработанных данных
   * Вызывается независимо от обработки изображений
   */
  async generateMessageFromContext() {
    if (!this.state.isActive || this.state.silenceMode) {
      return null;
    }

    // В режиме обучения мозг не генерирует сообщения, только обучается
    if (this.modules.brainCoordinator && this.modules.brainCoordinator.mode === 'training') {
      return null; // Не генерируем сообщения в режиме обучения
    }

    // Мозг сам решает через updateTime() - проверяем его решение
    if (this.modules.brainCoordinator) {
      const timeCheck = this.modules.brainCoordinator.updateTime(Date.now(), {});
      if (timeCheck.shouldWait) {
        // Мозг решил подождать
        return null;
      }
    }

    try {
      console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('[Coordinator] 🧠 МОЗГ: Генерация сообщения из контекста');
      
      // Используем последние обработанные данные
      const latestImageAnalysis = this.contextBuffer.recentImageAnalysis[this.contextBuffer.recentImageAnalysis.length - 1];
      const latestSpeechText = this.contextBuffer.recentSpeechText[this.contextBuffer.recentSpeechText.length - 1] || null;
      
      if (!latestImageAnalysis) {
        console.log('[Coordinator] ⚠️ Нет обработанных изображений');
        return null;
      }

      console.log('[Coordinator] 🧠 Шаг 1: Принятие решения о генерации сообщения...');
      const shouldGenerate = this.shouldGenerateMessage(latestImageAnalysis, latestSpeechText);
      
      if (!shouldGenerate) {
        this.state.skippedMessages++;
        console.log('[Coordinator] 🧠 РЕШЕНИЕ МОЗГА: ❌ НЕ генерировать сообщение');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        return null;
      }
      
      console.log('[Coordinator] 🧠 РЕШЕНИЕ МОЗГА: ✅ Генерировать сообщение');

      // Собираем информацию о недавних говорящих
      const recentSpeakers = this.contextBuffer.recentSpeechText
        .map(s => ({
          name: s.speakerName || s.speaker,
          isStreamer: s.isStreamer,
          text: s.text,
          type: s.voiceType,
        }))
        .slice(-3);
      
      console.log('[Coordinator] 💬 Шаг 2: Генерация сообщения...');
      if (latestSpeechText) {
        console.log(`[Coordinator]    Используется речь от: ${latestSpeechText.speakerName || latestSpeechText.speaker} (${latestSpeechText.isStreamer ? 'стример' : 'гость'})`);
      }
      
      // Определяем сложность задачи
      const context = {
        imageAnalysis: latestImageAnalysis,
        speechText: latestSpeechText,
        chatHistory: this.contextBuffer.chatHistory,
        streamContext: {
          recentSpeakers: recentSpeakers,
        },
        botUsername: this.config.twitch?.username || 'бот', // Имя бота для понимания обращений
        time: Date.now(), // Передаем время мозгу
      };
      
      // Обновляем время в мозге с контекстом
      if (this.modules.brainCoordinator) {
        this.modules.brainCoordinator.updateTime(context.time, context);
      }
      
      // Проверяем, нужен ли помощник мозга для сложной задачи
      const isComplex = this.modules.brainCoordinator?.shouldUseBrainAssistant(context);
      
      let messageResult;
      
      // Оптимизируем промпт через BrainCoordinator
      // Получаем базовый промпт из messageGenerator для оптимизации
      let optimizedPrompt = null;
      if (this.modules.brainCoordinator && this.modules.messageGenerator) {
        // Получаем базовый промпт из messageGenerator
        const basePrompt = this.modules.messageGenerator.getBasePrompt?.(context) || '';
        optimizedPrompt = await this.modules.brainCoordinator.optimizeMessagePrompt(basePrompt, context);
      }
      
      if (isComplex && this.modules.brainAssistant) {
        console.log('[Coordinator] 🧠 Сложная задача - используем помощника мозга...');
        // Используем помощника для сложных задач
        const assistantResult = await this.modules.brainAssistant.solveComplexMessageTask(context, optimizedPrompt || '');
        
        // Убеждаемся, что assistantResult - строка
        let assistantText = (assistantResult && typeof assistantResult === 'string') 
          ? assistantResult 
          : (assistantResult && typeof assistantResult === 'object' && assistantResult.text) 
            ? assistantResult.text 
            : String(assistantResult || '');
        
        // Очищаем от мета-комментариев и проверяем язык
        assistantText = this.cleanAssistantMessage(assistantText);
        
        if (assistantText && assistantText !== 'null' && assistantText.trim().length > 3) {
          messageResult = {
            message: assistantText.trim(),
            confidence: 0.8,
          };
        } else {
          // Fallback на обычный генератор
          messageResult = await this.generateWithMessageGenerator(context, optimizedPrompt);
        }
      } else {
        // Обычная генерация с оптимизированным промптом
        messageResult = await this.generateWithMessageGenerator(context, optimizedPrompt);
      }

      if (!messageResult || !messageResult.message) {
        this.state.skippedMessages++;
        console.log('[Coordinator] ⚠️ Сообщение не сгенерировано');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        return null;
      }

      // Финальная проверка
      console.log('[Coordinator] 📤 Шаг 3: Финальная проверка...');
      const shouldSend = this.shouldSendMessage(messageResult);
      
      if (!shouldSend) {
        this.state.skippedMessages++;
        console.log('[Coordinator] ❌ Сообщение не прошло финальную проверку');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        return null;
      }

      this.state.lastMessageTime = Date.now();
      this.state.totalMessages++;
      console.log(`[Coordinator] ✅ Сообщение готово! Всего отправлено: ${this.state.totalMessages}`);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

      return messageResult.message;
    } catch (error) {
      console.error('[Coordinator] Ошибка генерации сообщения:', error);
      return null;
    }
  }

  /**
   * Генерация сообщения с поддержкой нескольких экземпляров
   */
  async generateWithMessageGenerator(context, optimizedPrompt = null) {
    // Проверяем, занят ли первый генератор
    if (this.modules.messageGenerator.isBusy && this.modules.messageGenerator2) {
      console.log('[Coordinator] 💬 Первый генератор занят, используем второй...');
      return await this.modules.messageGenerator2.generateMessage(context, optimizedPrompt);
    }
    
    // Используем первый генератор
    this.modules.messageGenerator.isBusy = true;
    try {
      const result = await this.modules.messageGenerator.generateMessage(context, optimizedPrompt);
      return result;
    } finally {
      this.modules.messageGenerator.isBusy = false;
    }
  }

  shouldGenerateMessage(imageAnalysis, speechText) {
    // Проверка режима молчания
    if (this.state.silenceMode) {
      return false;
    }

      // Мозг сам решает через updateTime() - проверяем его решение
      if (this.modules.brainCoordinator) {
        const timeCheck = this.modules.brainCoordinator.updateTime(Date.now(), {
          imageAnalysis,
          speechText,
        });
        if (timeCheck.shouldWait) {
          return false; // Мозг решил подождать
        }
      }

    // Проверка качества данных (ПРИОРИТЕТ - РЕЧЬ СТРИМЕРА!)
    let hasGoodData = false;

    // ГЛАВНЫЙ ПРИОРИТЕТ: Речь стримера
    if (speechText && speechText.isStreamer && speechText.confidence >= this.config.minConfidence) {
      hasGoodData = true; // Если говорит стример - это ОБЯЗАТЕЛЬНО генерируем сообщение
    }
    
    // Речь гостя - тоже важно, но менее приоритетно
    if (speechText && !speechText.isStreamer && speechText.confidence >= this.config.minConfidence) {
      hasGoodData = true;
    }

    // Изображение - дополнительный контекст
    if (imageAnalysis && imageAnalysis.confidence >= this.config.minConfidence) {
      hasGoodData = true;
    }
    
    // ЧАТ НЕ ЯВЛЯЕТСЯ ИСТОЧНИКОМ для генерации - только для обучения стилю

    // Если данных недостаточно, но прошло много времени - можно попробовать
    const timeSinceLastMessage = this.state.lastMessageTime > 0 
      ? Date.now() - this.state.lastMessageTime 
      : Infinity; // Если сообщений еще не было, считаем что прошло бесконечно времени
    if (!hasGoodData && timeSinceLastMessage > 30000) {
      hasGoodData = true;
    }

    return hasGoodData;
  }

  /**
   * Очистка сообщения от помощника от мета-комментариев
   */
  cleanAssistantMessage(text) {
    if (!text || typeof text !== 'string') return null;
    
    let cleaned = text.trim();
    
    // Удаляем мета-комментарии в начале
    const metaPatterns = [
      /^.*?(?:спасибо за задание|я могу создать|я могу|как.*?помощник|as.*?assistant|as.*?ai|i'm here to help|i can|here's|вот|давайте попробуем|hey there|fellow twitch)/i,
      /^.*?(?:message:|сообщение:|результат:|result:|explanation:)/i,
      /^["'«»]/, // Удаляем кавычки в начале
      /["'«»]$/, // Удаляем кавычки в конце
    ];
    
    for (const pattern of metaPatterns) {
      cleaned = cleaned.replace(pattern, '').trim();
    }
    
    // Если сообщение начинается с кавычек - извлекаем содержимое
    const quotedMatch = cleaned.match(/^["'«»](.+?)["'«»]$/);
    if (quotedMatch) {
      cleaned = quotedMatch[1].trim();
    }
    
    // Удаляем объяснения после сообщения (типа "This message...")
    const explanationPattern = /\n.*?(?:this message|это сообщение|explanation|объяснение)/i;
    cleaned = cleaned.split(explanationPattern)[0].trim();
    
    // Проверяем язык - если больше английских слов чем русских, отбрасываем
    const russianChars = (cleaned.match(/[а-яё]/gi) || []).length;
    const englishChars = (cleaned.match(/[a-z]/gi) || []).length;
    
    // Если английских символов больше чем русских - отбрасываем
    if (englishChars > russianChars && russianChars < 5) {
      console.log('[Coordinator] ⚠️ Сообщение от помощника на английском языке, отбрасываем');
      return null;
    }
    
    // Если сообщение слишком длинное (больше 300 символов) - обрезаем
    if (cleaned.length > 300) {
      cleaned = cleaned.substring(0, 297) + '...';
    }
    
    // Если сообщение слишком короткое или пустое - отбрасываем
    if (cleaned.length < 3) {
      return null;
    }
    
    return cleaned;
  }

  shouldSendMessage(messageResult) {
    if (!messageResult) {
      return false;
    }

    const message = messageResult.message.trim();

    // Проверка на пустоту или мусор
    if (message.length < 3) {
      return false;
    }

    // ПРОВЕРКА ТОЛЬКО НА БАНВОРДЫ TWITCH
    // Генератор сообщений ограничен ТОЛЬКО банвордами Twitch
    // Мозг сам ограничивает себя на запрещенные темы и политику
    
    // Банворды Twitch (основные)
    const twitchBannedWords = [
      /nigg/i, /fagg/i, /kike/i, // Расовые/дискриминационные оскорбления
    ];
    
    // Проверяем ТОЛЬКО на банворды Twitch
    for (const pattern of twitchBannedWords) {
      if (pattern.test(message)) {
        console.log(`[Coordinator] 🚫 Сообщение содержит банворд Twitch: ${message.substring(0, 50)}...`);
        return false;
      }
    }

    // Проверка уверенности (оставляем для качества)
    if (messageResult.confidence < this.config.minConfidence) {
      return false;
    }

    return true;
  }

  // Методы управления координатором
  setSilenceMode(enabled) {
    this.state.silenceMode = enabled;
    console.log(`[Coordinator] Режим молчания: ${enabled ? 'ВКЛ' : 'ВЫКЛ'}`);
  }

  setActive(active) {
    this.state.isActive = active;
    console.log(`[Coordinator] Активность: ${active ? 'ВКЛ' : 'ВЫКЛ'}`);
  }

  // setMessageCooldown убран - мозг сам решает когда отправлять сообщения

  updateChatHistory(message) {
    this.contextBuffer.chatHistory.push(message);
    // Храним только последние 20 сообщений
    if (this.contextBuffer.chatHistory.length > 20) {
      this.contextBuffer.chatHistory.shift();
    }
  }

  getStats() {
    return {
      ...this.state,
      contextBufferSize: {
        imageAnalysis: this.contextBuffer.recentImageAnalysis.length,
        speechText: this.contextBuffer.recentSpeechText.length,
        chatHistory: this.contextBuffer.chatHistory.length,
      },
    };
  }
}
