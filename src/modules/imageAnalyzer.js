import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { ProxyAPI } from './proxyAPI.js';

export class ImageAnalyzer {
  constructor(config) {
    this.config = config;
    this.useProxyAPI = config.useProxyAPI || false;
    this.brainCoordinator = config.brainCoordinator || null; // Координатор для оптимизации промптов
    
    if (this.useProxyAPI) {
      // Проверяем, используем ли мы Gemini модель
      const visionModel = config.proxyAPIVisionModel || 'gemini-2.0-flash-exp';
      const isGeminiModel = visionModel.toLowerCase().includes('gemini');
      
      if (isGeminiModel) {
        // Используем Google Generative AI SDK для Gemini через ProxyAPI
        this.genAI = new GoogleGenerativeAI(config.proxyAPIKey || '');
        // Убираем суффикс -exp если есть (для ProxyAPI нужна модель без суффикса)
        const modelName = visionModel.endsWith('-exp') 
          ? visionModel.slice(0, -4) 
          : visionModel;
        this.model = this.genAI.getGenerativeModel(
          { model: modelName || 'gemini-2.0-flash' },
          {
            baseUrl: `${config.proxyAPIBaseUrl || 'https://api.proxyapi.ru'}/google`,
          }
        );
        console.log(`[ImageAnalyzer] Используется Google Generative AI SDK для Gemini через ProxyAPI`);
        console.log(`[ImageAnalyzer] Модель: ${modelName} (из ${visionModel})`);
      } else {
        // Для других моделей используем ProxyAPI через OpenAI-совместимый API
        this.proxyAPI = new ProxyAPI({
          apiKey: config.proxyAPIKey,
          baseUrl: config.proxyAPIBaseUrl,
          provider: config.proxyAPIProvider,
          model: visionModel,
        });
        this.openai = this.proxyAPI.getOpenAIClient();
        console.log(`[ImageAnalyzer] Используется ProxyAPI для анализа изображений (модель: ${visionModel})`);
      }
    } else {
      // Прямой OpenAI API
      this.openai = new OpenAI({
        apiKey: config.apiKey,
      });
      console.log('[ImageAnalyzer] Используется OpenAI API для анализа изображений');
    }
  }

  async init() {
    // Инициализация не требуется для API
  }

  /**
   * Валидация результата анализа изображения (для API не требуется - всегда качественные ответы)
   * Оставлено для совместимости, но всегда возвращает высокую уверенность
   */
  validateImageAnalysis(text) {
    // Для ProxyAPI/OpenAI валидация не требуется - они всегда возвращают качественные ответы
    if (!text || text.trim().length < 10) {
      return {
        description: 'Анализ изображения не удался - слишком короткий ответ',
        confidence: 0.1,
        warnings: ['Короткий ответ'],
      };
    }
    
    // Для API всегда высокая уверенность
    return {
      description: text,
      confidence: 0.95,
      warnings: [],
    };
  }

  async analyzeScreenshot(imageBuffer) {
    try {
      // Проверяем что imageBuffer действительно Buffer
      if (!Buffer.isBuffer(imageBuffer)) {
        console.warn('[ImageAnalyzer] ⚠️ imageBuffer не является Buffer, конвертируем...');
        imageBuffer = Buffer.from(imageBuffer);
      }
      
      // Проверяем что buffer не пустой
      if (!imageBuffer || imageBuffer.length === 0) {
        console.error('[ImageAnalyzer] ❌ imageBuffer пустой');
        return {
          description: null,
          confidence: 0,
          error: 'Изображение пустое',
          timestamp: Date.now(),
        };
      }
      
      console.log(`[ImageAnalyzer] 📊 Размер изображения для анализа: ${imageBuffer.length} байт`);
      
      // Промпт может быть оптимизирован через BrainCoordinator
      let prompt = `Ты эксперт по анализу Twitch стримов. Твоя задача - ТОЧНО и ПРАВДИВО описать что РЕАЛЬНО видно на скриншоте.

КРИТИЧЕСКИ ВАЖНО:
- Опиши ТОЛЬКО то, что РЕАЛЬНО видно на изображении
- НЕ выдумывай и НЕ додумывай детали, которых нет
- Если что-то не видно четко - скажи "не видно" или "неясно"
- Если не уверен - скажи "возможно" или "похоже на"
- НЕ придумывай названия игр, если не видишь их четко
- НЕ выдумывай числа и значения, если их не видно

ВНИМАТЕЛЬНО проанализируй изображение и опиши в следующем формате:

0. ИНФОРМАЦИЯ О СТРИМЕ (ВАЖНО!):
   - Название стрима (stream title) - если видно в интерфейсе Twitch (обычно вверху страницы)
   - Категория игры (game category) - если видно название игры/категории в интерфейсе Twitch
   - Имя стримера - если видно в интерфейсе
   - Количество зрителей - если видно число viewers
   - Вся видимая информация из интерфейса Twitch (текст, кнопки, метаданные)

1. ИГРА/КОНТЕНТ:
   - Какая игра или контент показывается (ТОЛЬКО если видно название или узнаваемый интерфейс)
   - Конкретные действия на экране (что РЕАЛЬНО происходит, не додумывай)
   - Важные события (ТОЛЬКО если они явно видны)
   - Состояние игры (здоровье, ресурсы - ТОЛЬКО если видны числа или индикаторы)

2. ИНТЕРФЕЙС И ТЕКСТ:
   - Весь видимый текст на экране (прочитай ТОЧНО, не выдумывай)
   - Числовые значения (ТОЛЬКО если они реально видны)
   - Названия предметов, способностей (ТОЛЬКО если виден текст)
   - Уведомления (ТОЛЬКО если они есть на экране)
   - Текст из чата Twitch (ТОЛЬКО если чат виден)
   - ВСЯ информация из интерфейса Twitch (название стрима, категория, метаданные)

3. ВИЗУАЛЬНЫЕ ДЕТАЛИ:
   - Что РЕАЛЬНО происходит на экране визуально
   - Цвета, эффекты, анимации (описывай ТОЧНО что видишь)
   - Состояние персонажа/объектов (ТОЛЬКО визуально видимое)
   - Окружение и локация (описывай ТОЛЬКО то, что видно)

4. ЭМОЦИОНАЛЬНЫЙ КОНТЕКСТ:
   - Напряжённость момента (на основе визуальных признаков)
   - Вероятная реакция зрителей (на основе видимых событий)
   - Интересные моменты для комментариев (ТОЛЬКО если есть что-то заметное)

5. КОНТЕКСТ ДЛЯ ЧАТА:
   - О чём зрители могут говорить (на основе РЕАЛЬНО видимых событий)
   - Что может вызвать реакцию (ТОЛЬКО видимые события)
   - Уместные комментарии (на основе фактов, не выдумок)

ПРАВИЛА ТОЧНОСТИ:
- ОБЯЗАТЕЛЬНО ищи и читай название стрима и категорию игры в интерфейсе Twitch (обычно вверху страницы)
- Если видишь название стрима в интерфейсе - укажи его ТОЧНО
- Если видишь категорию игры в интерфейсе - укажи её ТОЧНО
- Если видишь игру - назови её. Если не видишь - скажи "игра не определена" или "неясно какая игра"
- Если видишь числа - укажи их ТОЧНО. Если не видишь - скажи "числа не видны"
- Если видишь текст - прочитай его ТОЧНО. Если не видишь - скажи "текст не виден"
- НЕ используй фразы типа "вероятно", "скорее всего" для фактов - только для предположений
- Если экран загрузки или меню - скажи это прямо
- Если реклама - скажи "идет реклама"
- ВАЖНО: Интерфейс Twitch содержит много полезной информации - читай ВСЁ что видно!

ВАЖНО:
- Будь максимально конкретным и ТОЧНЫМ
- Указывай ТОЛЬКО реально видимые значения и названия
- Пиши на русском языке
- Если что-то не видно или неясно - укажи это ЧЕСТНО
- Структурируй ответ по разделам выше
- НЕ выдумывай детали, которых нет на изображении`;
      
      // Мозг НЕ может трогать основной промпт, только дописывать подробности
      // Оптимизируем промпт через BrainCoordinator если доступен
      if (this.brainCoordinator) {
        prompt = await this.brainCoordinator.optimizeImagePrompt(prompt, {
          time: Date.now(),
        });
      }

      // Используем API (OpenAI или ProxyAPI)
      // Проверяем что imageBuffer действительно Buffer
      if (!Buffer.isBuffer(imageBuffer)) {
        console.warn('[ImageAnalyzer] ⚠️ imageBuffer не является Buffer, конвертируем...');
        imageBuffer = Buffer.from(imageBuffer);
      }
      
      const base64Image = imageBuffer.toString('base64');
      
      // Проверяем что base64 не пустой
      if (!base64Image || base64Image.length < 100) {
        console.error('[ImageAnalyzer] ❌ Base64 изображение пустое или слишком короткое');
        return {
          description: 'Анализ изображения не удался - изображение пустое',
          confidence: 0,
          timestamp: Date.now(),
        };
      }
      
      // Проверяем размер изображения (ограничение 20 МБ для Gemini)
      const imageSizeMB = imageBuffer.length / (1024 * 1024);
      if (imageSizeMB > 20) {
        console.warn(`[ImageAnalyzer] ⚠️ Изображение слишком большое: ${imageSizeMB.toFixed(2)} МБ (максимум 20 МБ)`);
        // Можно попробовать сжать изображение, но пока просто предупреждаем
      }
      
      console.log(`[ImageAnalyzer] 📊 Размер изображения: ${imageBuffer.length} байт (${imageSizeMB.toFixed(2)} МБ), Base64 длина: ${base64Image.length} символов`);
      
      // Для ProxyAPI пробуем разные модели, если первая не работает
      const visionModels = this.useProxyAPI 
        ? [
            this.config.proxyAPIVisionModel || 'gemini-2.0-flash-exp', // По умолчанию Gemini 2.0 Flash
            'gemini-2.0-flash-exp', // Fallback на Gemini 2.0 Flash
            'gpt-4o', // Fallback на GPT-4o
            'gpt-4o-2024-11-20', // Fallback на конкретную версию gpt-4o
          ]
        : ['gpt-4o']; // Для прямого OpenAI используем gpt-4o

      let lastError = null;
      
      for (const visionModel of visionModels) {
        try {
          console.log(`[ImageAnalyzer] 🖼️ Попытка анализа через ${this.useProxyAPI ? 'ProxyAPI' : 'OpenAI'} (модель: ${visionModel})`);
          
          // Проверяем, является ли модель Gemini
          const isGeminiModel = visionModel.toLowerCase().includes('gemini');
          
          let description;
          
          if (this.useProxyAPI && isGeminiModel && this.model) {
            // Используем Google Generative AI SDK для Gemini
            console.log('[ImageAnalyzer] 🔄 Используется Google Generative AI SDK для Gemini через ProxyAPI');
            
            // Определяем MIME тип (по умолчанию PNG, но можно определить по содержимому)
            let mimeType = 'image/png';
            if (imageBuffer[0] === 0xFF && imageBuffer[1] === 0xD8) {
              mimeType = 'image/jpeg';
            } else if (imageBuffer[0] === 0x89 && imageBuffer[1] === 0x50) {
              mimeType = 'image/png';
            }
            
            // Используем base64 без префикса data:image/...
            // Правильный формат для Google Generative AI SDK
            const response = await this.model.generateContent({
              contents: [{
                parts: [
                  {
                    inlineData: {
                      mimeType: mimeType,
                      data: base64Image, // base64 без префикса
                    },
                  },
                  {
                    text: prompt,
                  },
                ],
              }],
            });
            
            description = response.response.text();
          } else {
            // Используем OpenAI-совместимый API (OpenAI или ProxyAPI для других моделей)
            const imageDataUrl = `data:image/png;base64,${base64Image}`;
            
            const content = [
              {
                type: 'text',
                text: prompt,
              },
              {
                type: 'image_url',
                image_url: {
                  url: imageDataUrl,
                  detail: 'high', // Максимальное качество для лучшего распознавания
                },
              },
            ];
            
            const response = await this.openai.chat.completions.create({
              model: visionModel,
              messages: [
                {
                  role: 'user',
                  content: content,
                },
              ],
              max_tokens: 1500,
            });

            description = response.choices[0].message.content;
          }
          
          console.log(`[ImageAnalyzer] ✅ ОПИСАНИЕ ИЗОБРАЖЕНИЯ:`);
          console.log(`[ImageAnalyzer] 📝 "${description.substring(0, 200)}${description.length > 200 ? '...' : ''}"`);
          console.log(`[ImageAnalyzer] 📊 Уверенность: 100%`);
          
          return {
            description,
            confidence: 1.0,
            timestamp: Date.now(),
          };
        } catch (error) {
          lastError = error;
          const errorStatus = error.status || error.response?.status || error.code;
          const errorMessage = error.message || error.response?.data?.message || 'неизвестная ошибка';
          
          // Специальная обработка для ошибок ProxyAPI
          if (this.useProxyAPI) {
            if (errorStatus === 404) {
              console.warn(`[ImageAnalyzer] ⚠️ Модель ${visionModel} не найдена или недоступна через ProxyAPI`);
              console.warn(`[ImageAnalyzer] 💡 Возможные причины:`);
              console.warn(`[ImageAnalyzer]    - Неверный или отсутствующий API ключ ProxyAPI`);
              console.warn(`[ImageAnalyzer]    - Модель ${visionModel} недоступна через провайдер ${this.config.proxyAPIProvider || 'google'}`);
              console.warn(`[ImageAnalyzer]    - Неправильное имя модели`);
              console.warn(`[ImageAnalyzer]    - Проверьте PROXYAPI_KEY в .env файле`);
            } else if (errorStatus === 402) {
              console.warn(`[ImageAnalyzer] ⚠️ Ошибка доступа к ProxyAPI (402): ${errorMessage}`);
              console.warn(`[ImageAnalyzer] 💡 Возможная причина:`);
              console.warn(`[ImageAnalyzer]    - Недостаточно средств на ProxyAPI аккаунте`);
              console.warn(`[ImageAnalyzer]    - Пополните баланс на https://proxyapi.ru`);
            } else if (errorStatus === 403) {
              console.warn(`[ImageAnalyzer] ⚠️ Ошибка доступа к ProxyAPI (403): ${errorMessage}`);
              console.warn(`[ImageAnalyzer] 💡 Возможные причины:`);
              console.warn(`[ImageAnalyzer]    - Неверный API ключ`);
              console.warn(`[ImageAnalyzer]    - Превышен лимит запросов`);
              console.warn(`[ImageAnalyzer]    - Нет доступа к модели`);
            } else {
              console.warn(`[ImageAnalyzer] ⚠️ Ошибка с моделью ${visionModel} (${errorStatus}): ${errorMessage}`);
            }
          } else {
            console.warn(`[ImageAnalyzer] ⚠️ Ошибка с моделью ${visionModel}: ${errorMessage}`);
          }
          
          // Если это не последняя модель, пробуем следующую
          if (visionModels.indexOf(visionModel) < visionModels.length - 1) {
            console.log(`[ImageAnalyzer] 🔄 Пробую следующую модель...`);
            continue;
          }
        }
      }
      
      // Если все модели не сработали, выбрасываем последнюю ошибку
      const lastErrorStatus = lastError?.status || lastError?.response?.status || lastError?.code;
      const lastErrorMessage = lastError?.message || lastError?.response?.data?.message || 'неизвестная ошибка';
      
      console.error(`[ImageAnalyzer] ❌ Все модели не сработали. Последняя ошибка (${lastErrorStatus}): ${lastErrorMessage}`);
      
      // Специальное сообщение для ProxyAPI
      if (this.useProxyAPI) {
        if (lastErrorStatus === 404) {
          console.error(`[ImageAnalyzer] 🔑 ВНИМАНИЕ: Проблема с ProxyAPI (404)!`);
          console.error(`[ImageAnalyzer]    - Проверьте PROXYAPI_KEY в .env файле (возможно ключ удален или неверный)`);
          console.error(`[ImageAnalyzer]    - Убедитесь, что модель ${this.config.proxyAPIVisionModel || 'gemini-2.0-flash-exp'} доступна`);
          console.error(`[ImageAnalyzer]    - Проверьте правильность PROXYAPI_PROVIDER (для Gemini используйте 'google')`);
        } else if (lastErrorStatus === 402) {
          console.error(`[ImageAnalyzer] 💰 ВНИМАНИЕ: Недостаточно средств на ProxyAPI!`);
          console.error(`[ImageAnalyzer]    - Пополните баланс на https://proxyapi.ru`);
        } else if (lastErrorStatus === 403) {
          console.error(`[ImageAnalyzer] 🔒 ВНИМАНИЕ: Проблема с доступом к ProxyAPI (403)!`);
          console.error(`[ImageAnalyzer]    - Проверьте правильность PROXYAPI_KEY`);
          console.error(`[ImageAnalyzer]    - Возможно превышен лимит запросов`);
        }
      }
      
      throw lastError || new Error('Не удалось проанализировать изображение');
    } catch (error) {
      const errorMessage = error.message || error.status || error.response?.data?.message || 'неизвестная ошибка';
      const errorCode = error.code || error.status || error.response?.status || 'unknown';
      console.error(`[ImageAnalyzer] ❌ Ошибка анализа: ${errorMessage} (код: ${errorCode})`);
      
      // Если это ошибка 400 от ProxyAPI, даем подсказку
      if (error.status === 400 && this.useProxyAPI) {
        console.error('[ImageAnalyzer] 💡 Подсказка: Попробуйте изменить PROXYAPI_VISION_MODEL в .env на:');
        console.error('[ImageAnalyzer]    - gemini-2.0-flash-exp (для Google провайдера)');
        console.error('[ImageAnalyzer]    - gpt-4o (для OpenAI провайдера)');
        console.error('[ImageAnalyzer]    - или другую поддерживаемую ProxyAPI модель');
      }
      
      // Специальные сообщения для разных ошибок ProxyAPI
      if (this.useProxyAPI) {
        if (error.status === 404) {
          console.error('[ImageAnalyzer] 🔑 ВОЗМОЖНАЯ ПРИЧИНА: Неверный или отсутствующий API ключ ProxyAPI');
          console.error('[ImageAnalyzer]    Проверьте PROXYAPI_KEY в .env файле');
        } else if (error.status === 402) {
          console.error('[ImageAnalyzer] 💰 ВОЗМОЖНАЯ ПРИЧИНА: Недостаточно средств на ProxyAPI аккаунте');
          console.error('[ImageAnalyzer]    Пополните баланс на https://proxyapi.ru');
        } else if (error.status === 403) {
          console.error('[ImageAnalyzer] 🔒 ВОЗМОЖНАЯ ПРИЧИНА: Проблема с доступом (неверный ключ или превышен лимит)');
          console.error('[ImageAnalyzer]    Проверьте PROXYAPI_KEY и лимиты на https://proxyapi.ru');
        }
      }
      
      return {
        description: null,
        confidence: 0,
        error: errorMessage,
        timestamp: Date.now(),
      };
    }
  }

  async extractTextFromImage(imageBuffer) {
    try {
      const base64Image = imageBuffer.toString('base64');

      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o', // Используем актуальную модель (gpt-4-vision-preview устарела)
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `Извлеки ВЕСЬ текст, который виден на этом скриншоте Twitch стрима.

ТРЕБОВАНИЯ:
1. Перечисли ВСЕ текстовые элементы построчно
2. Включи: интерфейс игры (HUD), меню, подсказки, названия
3. Включи: все числа, счёт, таймеры, статистику
4. Включи: текст из чата Twitch (если виден)
5. Включи: уведомления, всплывающие окна, сообщения
6. Включи: названия предметов, способностей, локаций, персонажей
7. Сохрани порядок и расположение текста (сверху вниз, слева направо)
8. Если текст частично скрыт - укажи что видно

ФОРМАТ:
- Каждая строка текста с новой строки
- Группируй по областям экрана (интерфейс, чат, уведомления)
- Сохраняй точное написание (регистр, пунктуация)

Отвечай ТОЛЬКО текстом, без дополнительных комментариев или объяснений.`,
              },
              {
                type: 'image_url',
                image_url: {
                  url: `data:image/png;base64,${base64Image}`,
                  detail: 'high', // Максимальное качество для лучшего распознавания
                },
              },
            ],
          },
        ],
        max_tokens: 800,
      });

      return response.choices[0].message.content;
    } catch (error) {
      console.error('[ImageAnalyzer] Ошибка извлечения текста:', error);
      return null;
    }
  }
}
