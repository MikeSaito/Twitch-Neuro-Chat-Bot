export class Coordinator {
  constructor(config, modules) {
    this.config = config;
    this.modules = modules;
    this.sessionHistory = modules.sessionHistory; // История сессии
    this.state = {
      isActive: true,
      silenceMode: false,
      lastMessageTime: 0,
      lastGeminiRequestTime: 0, // Время последнего запроса к Gemini
      geminiCooldown: 15000, // Минимальный интервал между запросами к Gemini (15 секунд)
      // messageCooldown убран - мозг сам решает через brainCoordinator.updateTime()
      totalMessages: 0,
      skippedMessages: 0,
      recentMessages: [], // История последних сообщений для проверки на повторения
      duplicateCount: 0, // Счетчик повторяющихся сообщений для уведомления ИИ
      isFirstMessage: true, // Флаг первого сообщения при запуске
    };
    this.contextBuffer = {
      recentImageAnalysis: [],
      recentSpeechText: [],
      chatHistory: [],
    };
    
    // Буфер для накопления фраз перед анализом
    this.speechBuffer = [];
    this.lastSpeechAnalysisTime = 0;
    this.speechAnalysisCooldown = 15000; // Анализируем накопленные фразы каждые 15 секунд
    
    // Последний скриншот для генерации сообщений через Gemini
    this.latestScreenshot = null;
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
      return;
    }

    try {
      // Распознавание речи
      let speechText = await this.modules.speechRecognizer.recognizeFromStream(audioBuffer);
      
      // Если речь не распознана - создаем объект "молчание" и продолжаем обработку
      if (!speechText || !speechText.text) {
        speechText = {
          text: 'молчание',
          confidence: 0.1,
          timestamp: Date.now(),
          isSilence: true,
        };
      }
      
      // Идентификация говорящего (пропускаем для молчания)
      let voiceIdentification = null;
      if (!speechText.isSilence) {
        // Фильтруем неправильные фразы из распознавания речи
        if (this.modules.brainCoordinator && this.modules.brainCoordinator.filterSpeechErrors) {
          const filtered = this.modules.brainCoordinator.filterSpeechErrors(speechText);
          if (!filtered) {
            // Фраза отфильтрована как неправильная
            return;
          }
          speechText = filtered;
        }
        
        const currentImageAnalysis = this.contextBuffer.recentImageAnalysis[this.contextBuffer.recentImageAnalysis.length - 1] || null;
        
        // Передаем audioBuffer для анализа параметров голоса
        voiceIdentification = await this.modules.voiceIdentifier.identifySpeaker(
          speechText,
          currentImageAnalysis,
          audioBuffer // Передаем аудио буфер для анализа голоса
        );
        
        // Добавляем информацию о говорящем к данным речи
        speechText.speaker = voiceIdentification.speaker;
        speechText.isStreamer = voiceIdentification.isStreamer || false; // Явно устанавливаем флаг
        speechText.shouldIgnore = voiceIdentification.shouldIgnore;
        speechText.speakerName = voiceIdentification.name;
        speechText.voiceType = voiceIdentification.type;
        speechText.speakerId = voiceIdentification.speaker;
        
        // Дополнительная проверка: если не определено явно как гость - считаем стримером
        if (!voiceIdentification.isStreamer && voiceIdentification.type !== 'guest' && voiceIdentification.type !== 'donation') {
          // Если не гость и не донат - скорее всего стример
          speechText.isStreamer = true;
          console.log(`[Coordinator] ⚠️ Речь не определена явно - считаем стримером: "${speechText.text.substring(0, 50)}..."`);
        }
      } else {
        // Для молчания устанавливаем значения по умолчанию
        speechText.speaker = 'unknown';
        speechText.isStreamer = false;
        speechText.shouldIgnore = false;
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
      if (!voiceIdentification.shouldIgnore) {
        // Накопление фраз в буфере вместо немедленной передачи в ИИ
        this.speechBuffer.push({
          ...speechText,
          receivedAt: Date.now(),
        });
        
        // Ограничиваем размер буфера (последние 10 фраз)
        if (this.speechBuffer.length > 10) {
          this.speechBuffer.shift();
        }
        
        // Обновляем контекст только периодически (не после каждой фразы)
        const timeSinceLastAnalysis = Date.now() - this.lastSpeechAnalysisTime;
        if (timeSinceLastAnalysis >= this.speechAnalysisCooldown) {
          // Переносим накопленные фразы в контекст для анализа
          const speechRecognizer = this.modules.speechRecognizer;
          const hasUpdateMethod = speechRecognizer && typeof speechRecognizer.updateRealtimeTextBuffer === 'function';
          
          for (const bufferedSpeech of this.speechBuffer) {
            this.contextBuffer.recentSpeechText.push(bufferedSpeech);
            if (this.contextBuffer.recentSpeechText.length > 5) {
              this.contextBuffer.recentSpeechText.shift();
            }
            
            // Обновляем накопительный буфер текста в speechRecognizer
            if (hasUpdateMethod) {
              const fragmentText = bufferedSpeech.isStreamer 
                ? `[СТРИМЕР] ${bufferedSpeech.text}`
                : `[ГОСТЬ] ${bufferedSpeech.text}`;
              speechRecognizer.updateRealtimeTextBuffer(fragmentText, bufferedSpeech.timestamp);
            }
          }
          
          // Очищаем буфер после переноса
          this.speechBuffer = [];
          this.lastSpeechAnalysisTime = Date.now();
        }
        
        // Сохраняем речь для обучения (всегда, независимо от анализа)
        if (this.modules.dataCollector && this.modules.dataCollector.enabled) {
          this.modules.dataCollector.saveSpeech(speechText).catch(() => {});
        }
      }
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
      const imageAnalysis = await this.modules.imageAnalyzer.analyzeScreenshot(
        screenshot.buffer
      );

      if (imageAnalysis.description) {
        this.contextBuffer.recentImageAnalysis.push(imageAnalysis);
        if (this.contextBuffer.recentImageAnalysis.length > 5) {
          this.contextBuffer.recentImageAnalysis.shift();
        }
      }
      
      // Сохраняем последний скриншот для генерации сообщений через Gemini
      this.latestScreenshot = screenshot;

      // Распознавание речи (если есть аудио)
      if (audioData) {
        let speechText = await this.modules.speechRecognizer.recognizeFromStream(audioData);
        
        // Если речь не распознана - создаем объект "молчание" и продолжаем обработку
        if (!speechText || !speechText.text) {
          speechText = {
            text: 'молчание',
            confidence: 0.1,
            timestamp: Date.now(),
            isSilence: true,
          };
        }
        
        if (speechText) {
          // Идентификация говорящего (пропускаем для молчания)
          let voiceIdentification = null;
          if (!speechText.isSilence) {
            // Фильтруем неправильные фразы из распознавания речи
            if (this.modules.brainCoordinator && this.modules.brainCoordinator.filterSpeechErrors) {
              const filtered = this.modules.brainCoordinator.filterSpeechErrors(speechText);
              if (!filtered) {
                // Фраза отфильтрована как неправильная
                return;
              }
              speechText = filtered;
            }
            
            const currentImageAnalysis = this.contextBuffer.recentImageAnalysis[this.contextBuffer.recentImageAnalysis.length - 1] || imageAnalysis;
            
            voiceIdentification = await this.modules.voiceIdentifier.identifySpeaker(
              speechText,
              currentImageAnalysis,
              audioData
            );
            
            // Добавляем информацию о говорящем к данным речи
            speechText.speaker = voiceIdentification.speaker;
            speechText.isStreamer = voiceIdentification.isStreamer || false; // Явно устанавливаем флаг
            speechText.shouldIgnore = voiceIdentification.shouldIgnore;
            speechText.speakerName = voiceIdentification.name;
            speechText.voiceType = voiceIdentification.type;
            speechText.speakerId = voiceIdentification.speaker;
            
            // Дополнительная проверка: если не определено явно как гость - считаем стримером
            if (!voiceIdentification.isStreamer && voiceIdentification.type !== 'guest' && voiceIdentification.type !== 'donation') {
              // Если не гость и не донат - скорее всего стример
              speechText.isStreamer = true;
              console.log(`[Coordinator] ⚠️ Речь не определена явно - считаем стримером: "${speechText.text.substring(0, 50)}..."`);
            }
          } else {
            // Для молчания устанавливаем значения по умолчанию
            speechText.speaker = 'unknown';
            speechText.isStreamer = false;
            speechText.shouldIgnore = false;
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
          if (!voiceIdentification.shouldIgnore || speechText.isSilence) {
            this.contextBuffer.recentSpeechText.push(speechText);
            if (this.contextBuffer.recentSpeechText.length > 5) {
              this.contextBuffer.recentSpeechText.shift();
            }
            
            // Обновляем накопительный буфер текста в speechRecognizer (только для стримера и гостей, не молчание)
            if (!speechText.isSilence && this.modules.speechRecognizer && typeof this.modules.speechRecognizer.updateRealtimeTextBuffer === 'function') {
              // Добавляем информацию о говорящем в фрагмент
              const fragmentText = speechText.isStreamer 
                ? `[СТРИМЕР] ${speechText.text}`
                : `[ГОСТЬ] ${speechText.text}`;
              this.modules.speechRecognizer.updateRealtimeTextBuffer(fragmentText, speechText.timestamp);
            }
            
            // Сохраняем речь для обучения (но не молчание)
            if (!speechText.isSilence && this.modules.dataCollector && this.modules.dataCollector.enabled) {
              this.modules.dataCollector.saveSpeech(speechText).catch(() => {});
            }
            
            // Сохраняем речь стримера в историю сессии
            if (speechText.isStreamer && !speechText.isSilence && this.sessionHistory) {
              this.sessionHistory.addStreamerSpeech(speechText.text, speechText.timestamp).catch(() => {});
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
    if (!this.state.isActive) {
      return null;
    }

    if (this.state.silenceMode) {
      return null;
    }

    // В режиме обучения мозг не генерирует сообщения, только обучается
    if (this.modules.brainCoordinator && this.modules.brainCoordinator.mode === 'training') {
      return null; // Не генерируем сообщения в режиме обучения
    }

    // Вычисляем время с последнего сообщения (для всех случаев)
    const timeSinceLastMessage = this.state.lastMessageTime > 0 
      ? Date.now() - this.state.lastMessageTime 
      : Infinity;

    // Для первого сообщения - принудительно генерируем (не проверяем время)
    if (!this.state.isFirstMessage) {
      // Мозг сам решает через updateTime() - проверяем его решение
      // НО: если прошло много времени - игнорируем решение мозга
      
      // Если прошло больше 15 секунд - игнорируем решение мозга о задержке (уменьшено для большей активности)
      if (timeSinceLastMessage < 15000 && this.modules.brainCoordinator) {
        const timeCheck = this.modules.brainCoordinator.updateTime(Date.now(), {});
        if (timeCheck.shouldWait) {
          // Мозг решил подождать
          return null;
        }
      }
    }

    try {
      // Используем последние обработанные данные
      const latestImageAnalysis = this.contextBuffer.recentImageAnalysis[this.contextBuffer.recentImageAnalysis.length - 1] || null;
      const latestSpeechText = this.contextBuffer.recentSpeechText[this.contextBuffer.recentSpeechText.length - 1] || null;
      
      // Смягчаем условия: разрешаем генерацию даже без данных, если прошло много времени
      // (переменная timeSinceLastMessage уже объявлена в начале метода)
      
      // Если прошло больше 15 секунд - генерируем сообщение в любом случае (уменьшено для большей активности)
      const shouldForceGenerate = timeSinceLastMessage > 15000;
      
      if (!shouldForceGenerate && !latestImageAnalysis && !latestSpeechText) {
        return null;
      }

      const shouldGenerate = shouldForceGenerate || this.shouldGenerateMessage(latestImageAnalysis, latestSpeechText);
      
      if (!shouldGenerate) {
        this.state.skippedMessages++;
        return null;
      }

      // Собираем информацию о недавних говорящих
      const recentSpeakers = this.contextBuffer.recentSpeechText
        .map(s => ({
          name: s.speakerName || s.speaker,
          isStreamer: s.isStreamer,
          text: s.text,
          type: s.voiceType,
        }))
        .slice(-3);
      
      // Получаем только последние фрагменты речи (последние 30 секунд)
      // НЕ передаем весь накопительный текст - только последние фрагменты
      const recentSpeechFragments = this.getRecentSpeechFragments(10);
      
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
        // Только последние фрагменты речи (последние 30 секунд), не весь накопительный текст
        recentSpeechFragments: recentSpeechFragments, // Последние фрагменты с временными метками
        isFirstMessage: this.state.isFirstMessage, // Флаг первого сообщения при запуске
      };
      
      // Обновляем время в мозге с контекстом
      if (this.modules.brainCoordinator) {
        this.modules.brainCoordinator.updateTime(context.time, context);
      }
      
      // Генерируем сообщение через мозг (brainCoordinator)
      // Мозг знает информацию с картинки, получает сообщения из чата и генерирует сообщения
      let messageResult = null;
      
      // Диагностика: проверяем, что передается мозгу
      const hasImage = !!latestImageAnalysis?.description;
      const hasSpeech = !!(latestSpeechText?.text && latestSpeechText.text !== 'молчание');
      const hasRealtimeSpeech = !!(recentSpeechFragments && recentSpeechFragments.length > 0);
      const speechIsStreamer = latestSpeechText?.isStreamer || false;
      const imagePreview = hasImage ? latestImageAnalysis.description.substring(0, 100) + '...' : 'нет';
      const speechPreview = hasSpeech ? latestSpeechText.text.substring(0, 50) + '...' : hasRealtimeSpeech ? (recentSpeechFragments[recentSpeechFragments.length - 1]?.text || '').substring(0, 50) + '...' : 'нет';
      
      // Выводим диагностику в консоль
      console.log(`[Coordinator] 📊 Данные для мозга: изображение=${hasImage ? 'есть' : 'нет'}, речь=${hasSpeech ? (speechIsStreamer ? 'стример' : 'гость') : hasRealtimeSpeech ? 'реалтайм' : 'нет'}`);
      
      // ИМБА: Используем Gemini для генерации сообщений напрямую, если есть скриншот и ProxyAPI включен
      // Проверяем кулдаун перед запросом к Gemini
      const timeSinceLastGeminiRequest = Date.now() - this.state.lastGeminiRequestTime;
      const canRequestGemini = timeSinceLastGeminiRequest >= this.state.geminiCooldown || this.state.isFirstMessage;
      
      if (this.latestScreenshot && 
          this.modules.imageAnalyzer && 
          this.modules.imageAnalyzer.useProxyAPI &&
          this.modules.imageAnalyzer.generateChatMessageFromScreenshot &&
          canRequestGemini) {
        try {
          console.log(`[Coordinator] 🚀 Используем Gemini для генерации сообщения (видит стрим напрямую!)`);
          // Обновляем время последнего запроса
          this.state.lastGeminiRequestTime = Date.now();
          
          // Добавляем историю сессии и информацию о повторениях в контекст
          const contextWithHistory = {
            ...context,
            sessionHistory: this.sessionHistory,
            duplicateCount: this.state.duplicateCount, // Передаем счетчик повторений для уведомления ИИ
            recentMessages: this.state.recentMessages.slice(-3), // Последние 3 сообщения для контекста
          };
          const geminiResult = await this.modules.imageAnalyzer.generateChatMessageFromScreenshot(
            this.latestScreenshot.buffer,
            contextWithHistory
          );
          
          if (geminiResult && geminiResult.text) {
            // Просто используем результат от Gemini - он уже решил молчать или писать
            messageResult = {
              message: geminiResult.text,
              confidence: geminiResult.confidence || 0.9,
              timestamp: geminiResult.timestamp || Date.now(),
              source: 'gemini_direct',
            };
            console.log(`[Coordinator] ✅ Gemini сгенерировал сообщение: "${geminiResult.text}"`);
          } else {
            console.log(`[Coordinator] 💭 Gemini решил молчать (null)`);
          }
        } catch (error) {
          console.warn(`[Coordinator] ⚠️ Ошибка генерации через Gemini, используем обычный метод:`, error.message);
          // Продолжаем с обычным методом
        }
      } else if (!canRequestGemini) {
        // Кулдаун еще не прошел
        const remainingCooldown = Math.ceil((this.state.geminiCooldown - timeSinceLastGeminiRequest) / 1000);
        console.log(`[Coordinator] ⏱️ Кулдаун Gemini: осталось ${remainingCooldown} сек`);
      }
      
      // Если Gemini не использовался или не вернул результат - молчим
      if (!messageResult) {
        return null;
      }

      if (!messageResult || !messageResult.message) {
        console.log('[Coordinator] ⚠️ Мозг не вернул сообщение (messageResult пустой)');
        this.state.skippedMessages++;
        return null;
      }

      // Финальная проверка
      const shouldSend = this.shouldSendMessage(messageResult);
      
      if (!shouldSend) {
        console.log(`[Coordinator] ⚠️ Сообщение не прошло финальную проверку: "${messageResult.message.substring(0, 50)}..."`);
        this.state.skippedMessages++;
        return null;
      }

      // Проверка на повторяющиеся сообщения (включая первое)
      const messageText = messageResult.message.toLowerCase().trim();
      const isDuplicate = this.state.recentMessages.some(recentMsg => {
        const similarity = this.calculateSimilarity(messageText, recentMsg.toLowerCase().trim());
        return similarity > 0.7; // Если сообщения похожи более чем на 70% - это повторение
      });

      if (isDuplicate) {
        this.state.duplicateCount++;
        console.log(`[Coordinator] ⚠️ Сообщение слишком похоже на предыдущие, отбрасываем: "${messageResult.message.substring(0, 50)}..."`);
        console.log(`[Coordinator] 📊 Повторяющихся сообщений подряд: ${this.state.duplicateCount}`);
        this.state.skippedMessages++;
        
        // Если повторений слишком много - уведомляем ИИ в следующем промпте
        if (this.state.duplicateCount >= 2) {
          console.log(`[Coordinator] ⚠️ ИИ повторяется! Будет уведомлен в следующем промпте.`);
        }
        
        return null;
      }
      
      // Если сообщение не повторяется - сбрасываем счетчик
      if (this.state.duplicateCount > 0) {
        console.log(`[Coordinator] ✅ ИИ перестал повторяться (было ${this.state.duplicateCount} повторений)`);
        this.state.duplicateCount = 0;
      }

      // Сохраняем сообщение в историю (храним последние 5 сообщений)
      this.state.recentMessages.push(messageText);
      if (this.state.recentMessages.length > 5) {
        this.state.recentMessages.shift();
      }
      
      if (this.state.isFirstMessage) {
        // Первое сообщение - сбрасываем флаг
        this.state.isFirstMessage = false;
        console.log(`[Coordinator] 🎉 Первое сообщение при запуске!`);
      }

      this.state.lastMessageTime = Date.now();
      this.state.totalMessages++;
      console.log(`💬 "${messageResult.message}"`);

      return messageResult.message;
    } catch (error) {
      console.error('[Coordinator] Ошибка генерации сообщения:', error);
      return null;
    }
  }


  shouldGenerateMessage(imageAnalysis, speechText) {
    // Проверка режима молчания
    if (this.state.silenceMode) {
      return false;
    }

    // Мозг сам решает через updateTime() - проверяем его решение
    // НО: если прошло много времени - игнорируем решение мозга
    const timeSinceLastMessage = this.state.lastMessageTime > 0 
      ? Date.now() - this.state.lastMessageTime 
      : Infinity;
    
    // Если прошло больше 15 секунд - игнорируем решение мозга о задержке (уменьшено для большей активности)
    if (timeSinceLastMessage < 15000 && this.modules.brainCoordinator) {
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

    // Динамический порог уверенности: чем больше времени прошло, тем ниже требования
    const dynamicConfidence = timeSinceLastMessage > 15000 
      ? 0.2  // Если прошло больше 15 секунд - очень низкий порог (уменьшено)
      : timeSinceLastMessage > 8000 
      ? 0.3  // Если прошло больше 8 секунд - низкий порог (уменьшено)
      : this.config.minConfidence || 0.4; // Иначе используем стандартный порог или 0.4

    // ГЛАВНЫЙ ПРИОРИТЕТ: Речь стримера
    if (speechText && speechText.isStreamer && speechText.confidence >= dynamicConfidence) {
      hasGoodData = true; // Если говорит стример - это ОБЯЗАТЕЛЬНО генерируем сообщение
    }
    
    // Речь гостя - тоже важно, но менее приоритетно
    if (speechText && !speechText.isStreamer && speechText.confidence >= dynamicConfidence) {
      hasGoodData = true;
    }

    // Изображение - дополнительный контекст
    if (imageAnalysis && imageAnalysis.confidence >= dynamicConfidence) {
      hasGoodData = true;
    }
    
    // Если есть хотя бы какие-то данные (даже с низкой уверенностью) и прошло много времени - используем их
    if (!hasGoodData && timeSinceLastMessage > 15000) {
      if (speechText && speechText.confidence > 0.1) {
        hasGoodData = true;
      }
      if (imageAnalysis && imageAnalysis.confidence > 0.1) {
        hasGoodData = true;
      }
    }
    
    // ЧАТ НЕ ЯВЛЯЕТСЯ ИСТОЧНИКОМ для генерации - только для обучения стилю

    // Если данных недостаточно, но прошло много времени - можно попробовать
    // (переменная timeSinceLastMessage уже объявлена в начале метода)
    if (!hasGoodData && timeSinceLastMessage > 8000) {
      hasGoodData = true;
    }

    if (!hasGoodData) {
      const speechInfo = speechText ? `речь=${speechText.isStreamer ? 'стример' : 'гость'}, conf=${speechText.confidence?.toFixed(2) || '?'}` : 'речи нет';
      const imageInfo = imageAnalysis ? `изображение, conf=${imageAnalysis.confidence?.toFixed(2) || '?'}` : 'изображения нет';
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
  
  /**
   * Получить текущий накопительный текст речи (для мозга)
   * @param {number} lastSeconds - Получить текст за последние N секунд
   * @returns {string} Текущий текст
   */
  getCurrentSpeechText(lastSeconds = null) {
    if (this.modules.speechRecognizer && typeof this.modules.speechRecognizer.getCurrentText === 'function') {
      return this.modules.speechRecognizer.getCurrentText(lastSeconds);
    }
    return '';
  }
  
  /**
   * Получить последние фрагменты речи
   * @param {number} count - Количество фрагментов
   * @returns {Array} Массив фрагментов
   */
  getRecentSpeechFragments(count = 5) {
    // Получаем фрагменты из speechRecognizer
    const fragmentsFromRecognizer = this.modules.speechRecognizer && typeof this.modules.speechRecognizer.getRecentFragments === 'function'
      ? this.modules.speechRecognizer.getRecentFragments(count)
      : [];
    
    // Также добавляем фрагменты из буфера (если они еще не перенесены)
    const bufferedFragments = this.speechBuffer
      .map(bufferedSpeech => ({
        text: bufferedSpeech.isStreamer 
          ? `[СТРИМЕР] ${bufferedSpeech.text}`
          : `[ГОСТЬ] ${bufferedSpeech.text}`,
        timestamp: bufferedSpeech.timestamp || bufferedSpeech.receivedAt || Date.now(),
        isStreamer: bufferedSpeech.isStreamer,
      }))
      .filter(f => f.text && f.text.trim().length > 0);
    
    // Объединяем и сортируем по времени (новые первыми)
    const allFragments = [...fragmentsFromRecognizer, ...bufferedFragments]
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
      .slice(0, count);
    
    return allFragments;
  }


  /**
   * Вычисление похожести двух сообщений (простой алгоритм)
   * @param {string} msg1 - Первое сообщение
   * @param {string} msg2 - Второе сообщение
   * @returns {number} Коэффициент похожести от 0 до 1
   */
  calculateSimilarity(msg1, msg2) {
    if (!msg1 || !msg2) return 0;
    
    // Нормализуем сообщения (убираем лишние пробелы, приводим к нижнему регистру)
    const normalize = (str) => str.toLowerCase().trim().replace(/\s+/g, ' ');
    const n1 = normalize(msg1);
    const n2 = normalize(msg2);
    
    // Если сообщения идентичны
    if (n1 === n2) return 1.0;
    
    // Проверяем, содержит ли одно сообщение другое (частичное совпадение)
    if (n1.includes(n2) || n2.includes(n1)) {
      const shorter = n1.length < n2.length ? n1 : n2;
      const longer = n1.length >= n2.length ? n1 : n2;
      return shorter.length / longer.length;
    }
    
    // Простое сравнение по словам (сколько общих слов)
    const words1 = new Set(n1.split(/\s+/));
    const words2 = new Set(n2.split(/\s+/));
    
    const intersection = new Set([...words1].filter(x => words2.has(x)));
    const union = new Set([...words1, ...words2]);
    
    if (union.size === 0) return 0;
    
    // Коэффициент Жаккара
    return intersection.size / union.size;
  }

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
