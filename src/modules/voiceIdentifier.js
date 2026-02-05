import OpenAI from 'openai';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { ProxyAPI } from './proxyAPI.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class VoiceIdentifier {
  constructor(config) {
    this.config = config;
    this.useProxyAPI = config.useProxyAPI || false;
    
    if (this.useProxyAPI) {
      // Используем ProxyAPI
      this.proxyAPI = new ProxyAPI({
        apiKey: config.proxyAPIKey,
        baseUrl: config.proxyAPIBaseUrl,
        provider: config.proxyAPIProvider,
        model: config.proxyAPIChatModel || 'gpt-4',
      });
      this.openai = this.proxyAPI.getOpenAIClient();
      console.log('[VoiceIdentifier] Используется ProxyAPI для идентификации голосов');
    } else {
      // Прямой OpenAI API
      this.openai = new OpenAI({
        apiKey: config.apiKey,
      });
    }
    this.voicesDatabase = new Map(); // Хранилище известных голосов
    this.voicesFilePath = path.join(__dirname, '../../data/voices.json');
    this.streamerName = config.streamerName || 'стример';
    this.learningMode = true; // Режим обучения новых голосов
  }

  async init() {
    // Загружаем базу данных голосов
    await this.loadVoicesDatabase();
    
    // Инициализируем профиль стримера, если его нет
    if (!this.voicesDatabase.has('streamer')) {
      this.voicesDatabase.set('streamer', {
        id: 'streamer',
        name: this.streamerName,
        type: 'streamer',
        patterns: [],
        examples: [],
        confidence: 0.8,
        learnedAt: Date.now(),
        lastSeen: Date.now(),
      });
      await this.saveVoicesDatabase();
    }
  }

  async loadVoicesDatabase() {
    try {
      const dataDir = path.dirname(this.voicesFilePath);
      await fs.mkdir(dataDir, { recursive: true });
      
      const data = await fs.readFile(this.voicesFilePath, 'utf-8');
      const voices = JSON.parse(data);
      
      this.voicesDatabase = new Map(Object.entries(voices));
      console.log(`[VoiceIdentifier] Загружено ${this.voicesDatabase.size} голосовых профилей`);
    } catch (error) {
      if (error.code === 'ENOENT') {
        console.log('[VoiceIdentifier] База данных голосов не найдена, создаю новую');
        this.voicesDatabase = new Map();
      } else {
        console.error('[VoiceIdentifier] Ошибка загрузки базы данных:', error);
        this.voicesDatabase = new Map();
      }
    }
  }

  async saveVoicesDatabase() {
    try {
      const dataDir = path.dirname(this.voicesFilePath);
      await fs.mkdir(dataDir, { recursive: true });
      
      const voicesObj = Object.fromEntries(this.voicesDatabase);
      await fs.writeFile(this.voicesFilePath, JSON.stringify(voicesObj, null, 2));
    } catch (error) {
      console.error('[VoiceIdentifier] Ошибка сохранения базы данных:', error);
    }
  }

  /**
   * Идентифицирует говорящего на основе текста и контекста
   */
  async identifySpeaker(speechData, imageContext = null) {
    if (!speechData || !speechData.text) {
      return {
        speaker: 'unknown',
        confidence: 0,
        type: 'unknown',
        isStreamer: false,
        shouldIgnore: true,
      };
    }

    const text = speechData.text.trim().toLowerCase();

    // 1. Проверка на донаты и TTS сообщения
    const donationCheck = this.checkIfDonation(text, imageContext);
    if (donationCheck.isDonation) {
      return {
        speaker: 'donation',
        confidence: donationCheck.confidence,
        type: 'donation',
        isStreamer: false,
        shouldIgnore: true,
        reason: 'Донат или TTS сообщение',
      };
    }

    // 2. Проверка на известные голоса
    const knownVoice = await this.checkKnownVoices(text, speechData);
    if (knownVoice.confidence > 0.7) {
      return {
        speaker: knownVoice.id,
        confidence: knownVoice.confidence,
        type: knownVoice.type,
        isStreamer: knownVoice.id === 'streamer',
        shouldIgnore: knownVoice.type === 'guest' && !this.shouldProcessGuest(knownVoice),
        name: knownVoice.name,
      };
    }

    // 3. Использование GPT для анализа и определения говорящего
    const gptAnalysis = await this.analyzeWithGPT(text, imageContext, speechData);
    
    // Если GPT анализ успешен или вернул fallback (при ошибке API)
    if (gptAnalysis && (gptAnalysis.confidence > 0.6 || gptAnalysis.speakerId)) {
      // Если это новый голос - запоминаем его
      if (gptAnalysis.isNewVoice && this.learningMode) {
        await this.learnNewVoice(gptAnalysis, text);
      }
      
      return {
        speaker: gptAnalysis.speakerId || 'unknown',
        confidence: gptAnalysis.confidence,
        type: gptAnalysis.type,
        isStreamer: gptAnalysis.isStreamer,
        shouldIgnore: gptAnalysis.shouldIgnore,
        name: gptAnalysis.name,
        isNewVoice: gptAnalysis.isNewVoice,
      };
    }

    // 4. По умолчанию считаем неизвестным
    return {
      speaker: 'unknown',
      confidence: 0.3,
      type: 'unknown',
      isStreamer: false,
      shouldIgnore: true,
      reason: 'Не удалось идентифицировать говорящего',
    };
  }

  /**
   * Проверяет, является ли речь донатом или TTS сообщением
   */
  checkIfDonation(text, imageContext) {
    // Паттерны донатов
    const donationPatterns = [
      /донат/i,
      /donat/i,
      /пожертвование/i,
      /подписка/i,
      /subscription/i,
      /бит/i,
      /bits/i,
      /спасибо за/i,
      /thank you for/i,
      /подписчик/i,
      /subscriber/i,
      /ресаб/i,
      /resub/i,
      /гифт/i,
      /gift/i,
    ];

    // Проверка текста
    const hasDonationPattern = donationPatterns.some(pattern => pattern.test(text));
    
    // Проверка контекста изображения (уведомления донатов обычно видны на экране)
    let imageHasDonation = false;
    if (imageContext?.description) {
      const imageText = imageContext.description.toLowerCase();
      imageHasDonation = donationPatterns.some(pattern => pattern.test(imageText)) ||
                        /уведомление|notification|alert/i.test(imageText);
    }

    if (hasDonationPattern || imageHasDonation) {
      return {
        isDonation: true,
        confidence: hasDonationPattern && imageHasDonation ? 0.95 : 0.8,
      };
    }

    // Проверка на TTS (обычно короткие фразы, читаемые роботом)
    if (text.length < 50 && /читает|читаю|tts|text to speech/i.test(text)) {
      return {
        isDonation: true,
        confidence: 0.85,
      };
    }

    return { isDonation: false, confidence: 0 };
  }

  /**
   * Проверяет известные голоса в базе данных
   */
  async checkKnownVoices(text, speechData) {
    let bestMatch = { id: 'unknown', confidence: 0, type: 'unknown', name: 'Неизвестный' };

    for (const [id, voice] of this.voicesDatabase.entries()) {
      let confidence = 0;

      // Проверка паттернов речи
      if (voice.patterns && voice.patterns.length > 0) {
        const matchingPatterns = voice.patterns.filter(pattern => 
          text.includes(pattern.toLowerCase())
        ).length;
        confidence += (matchingPatterns / voice.patterns.length) * 0.4;
      }

      // Проверка примеров
      if (voice.examples && voice.examples.length > 0) {
        const similarExamples = voice.examples.filter(example => {
          const similarity = this.calculateTextSimilarity(text, example);
          return similarity > 0.6;
        }).length;
        confidence += (similarExamples / voice.examples.length) * 0.3;
      }

      // Бонус для стримера (если часто встречается)
      if (id === 'streamer' && voice.lastSeen && (Date.now() - voice.lastSeen) < 60000) {
        confidence += 0.2;
      }

      if (confidence > bestMatch.confidence) {
        bestMatch = {
          id,
          confidence: Math.min(confidence, 1.0),
          type: voice.type,
          name: voice.name,
        };
      }
    }

    // Обновляем время последнего появления
    if (bestMatch.confidence > 0.6 && this.voicesDatabase.has(bestMatch.id)) {
      const voice = this.voicesDatabase.get(bestMatch.id);
      voice.lastSeen = Date.now();
      await this.saveVoicesDatabase();
    }

    return bestMatch;
  }

  /**
   * Использует GPT для анализа и определения говорящего
   */
  async analyzeWithGPT(text, imageContext, speechData) {
    try {
      const imageDesc = imageContext?.description?.substring(0, 500) || 'Нет визуального контекста';
      
      const prompt = `Ты эксперт по анализу Twitch стримов. Определи, кто говорит в данный момент.

ТЕКСТ РЕЧИ: "${text}"

ВИЗУАЛЬНЫЙ КОНТЕКСТ: ${imageDesc}

ИЗВЕСТНЫЕ ЛЮДИ:
- Стример: ${this.streamerName} (основной ведущий стрима)

ЗАДАЧА: Определи, кто говорит:
1. Стример (основной ведущий)
2. Гость/друг стримера (кто-то другой говорит)
3. Донат/TTS (читается донат или уведомление)
4. Неизвестный (не могу определить)

ОТВЕТЬ В ФОРМАТЕ JSON:
{
  "speakerType": "streamer" | "guest" | "donation" | "unknown",
  "isStreamer": true/false,
  "shouldIgnore": true/false,
  "confidence": 0.0-1.0,
  "name": "имя говорящего или null",
  "isNewVoice": true/false,
  "reason": "краткое объяснение"
}

ВАЖНО:
- Если это донат/TTS - shouldIgnore: true
- Если это гость, которого мы не знаем - isNewVoice: true
- Если это стример - isStreamer: true
- Будь точным в определении`;

      const response = await this.openai.chat.completions.create({
        model: 'gpt-4',
        messages: [
          { role: 'system', content: 'Ты эксперт по анализу речи в Twitch стримах. Отвечай только валидным JSON.' },
          { role: 'user', content: prompt },
        ],
        max_tokens: 300,
        temperature: 0.3,
      });

      const content = response.choices[0].message.content.trim();
      // Извлекаем JSON из ответа
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const analysis = JSON.parse(jsonMatch[0]);
        
        return {
          speakerId: analysis.speakerType === 'streamer' ? 'streamer' : 
                     analysis.speakerType === 'guest' ? `guest_${Date.now()}` : 'unknown',
          type: analysis.speakerType,
          isStreamer: analysis.isStreamer || false,
          shouldIgnore: analysis.shouldIgnore || false,
          confidence: analysis.confidence || 0.5,
          name: analysis.name || null,
          isNewVoice: analysis.isNewVoice || false,
          reason: analysis.reason || '',
        };
      }
    } catch (error) {
      // Обработка ошибки 402 (Payment Required) или других ошибок API
      if (error.status === 402 || error.status === 429 || error.status === 401) {
        console.warn(`[VoiceIdentifier] ⚠️ Ошибка API (${error.status}): ${error.status === 402 ? 'Недостаточно средств' : error.status === 429 ? 'Превышен лимит' : 'Неверный ключ'}`);
        console.warn('[VoiceIdentifier] 💡 Используем fallback: предполагаем, что это стример');
        
        // Fallback: предполагаем, что это стример (не блокируем обработку)
        return {
          speakerId: 'streamer',
          type: 'streamer',
          isStreamer: true,
          shouldIgnore: false, // НЕ игнорируем, обрабатываем речь
          confidence: 0.5, // Средняя уверенность
          name: 'стример',
          isNewVoice: false,
          reason: 'Fallback из-за ошибки API',
        };
      }
      
      console.error('[VoiceIdentifier] Ошибка GPT анализа:', error);
    }

    return {
      speakerId: 'unknown',
      type: 'unknown',
      isStreamer: false,
      shouldIgnore: true,
      confidence: 0.3,
      isNewVoice: false,
    };
  }

  /**
   * Запоминает новый голос
   */
  async learnNewVoice(analysis, text) {
    const voiceId = `guest_${Date.now()}`;
    const voiceName = analysis.name || `Гость ${this.voicesDatabase.size}`;
    
    const newVoice = {
      id: voiceId,
      name: voiceName,
      type: 'guest',
      patterns: this.extractPatterns(text),
      examples: [text],
      confidence: analysis.confidence,
      learnedAt: Date.now(),
      lastSeen: Date.now(),
    };

    this.voicesDatabase.set(voiceId, newVoice);
    await this.saveVoicesDatabase();
    
    console.log(`[VoiceIdentifier] 🎤 Запомнен новый голос: ${voiceName} (${voiceId})`);
    return voiceId;
  }

  /**
   * Извлекает паттерны из текста для запоминания
   */
  extractPatterns(text) {
    // Извлекаем ключевые слова и фразы
    const words = text.split(/\s+/).filter(w => w.length > 3);
    const patterns = words.slice(0, 5); // Берем первые 5 слов как паттерны
    return patterns;
  }

  /**
   * Вычисляет схожесть двух текстов
   */
  calculateTextSimilarity(text1, text2) {
    const words1 = new Set(text1.toLowerCase().split(/\s+/));
    const words2 = new Set(text2.toLowerCase().split(/\s+/));
    
    const intersection = new Set([...words1].filter(x => words2.has(x)));
    const union = new Set([...words1, ...words2]);
    
    return intersection.size / union.size;
  }

  /**
   * Определяет, нужно ли обрабатывать речь гостя
   */
  shouldProcessGuest(guestVoice) {
    // Можно добавить логику: обрабатывать только если гость говорит часто
    // или если это важный гость
    return true; // Пока обрабатываем всех гостей
  }

  /**
   * Получает информацию о голосе
   */
  getVoiceInfo(voiceId) {
    return this.voicesDatabase.get(voiceId) || null;
  }

  /**
   * Получает список всех известных голосов
   */
  getAllVoices() {
    return Array.from(this.voicesDatabase.values());
  }
}
