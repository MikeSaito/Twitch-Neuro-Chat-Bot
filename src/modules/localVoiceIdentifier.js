import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Локальная идентификация голоса по тексту и параметрам аудио
 * Работает без API, анализирует паттерны речи и характеристики голоса
 */
export class LocalVoiceIdentifier {
  constructor(config = {}) {
    this.config = config;
    this.streamerName = config.streamerName || 'стример';
    this.voicesDatabase = new Map();
    this.voicesFilePath = path.join(__dirname, '../../data/voices.json');
    
    // Паттерны для определения типа говорящего
    this.streamerPatterns = [
      // Обращения к зрителям
      /(привет|здравствуйте|добро пожаловать|спасибо за|подпис|лайк|фоллов)/i,
      // Комментарии к игре
      /(сейчас|смотрите|видите|вот|так|давайте|поехали)/i,
      // Вопросы к чату
      /(что думаете|как вам|нравится|понравилось)/i,
    ];
    
    this.donationPatterns = [
      /(донат|подписка|бит|суб|subscriber|donation|биты)/i,
      /(спасибо.*за.*подписку|спасибо.*за.*донат)/i,
    ];
    
    this.guestPatterns = [
      // Обращения к стримеру
      /(привет.*стример|здравствуй.*стример|эй.*стример)/i,
      // Вопросы стримеру
      /(как дела|что делаешь|как игра|почему)/i,
    ];
  }

  async init() {
    await this.loadVoicesDatabase();
    
    // Инициализируем профиль стримера
    if (!this.voicesDatabase.has('streamer')) {
      this.voicesDatabase.set('streamer', {
        id: 'streamer',
        name: this.streamerName,
        type: 'streamer',
        patterns: this.streamerPatterns,
        audioFeatures: {
          avgPitch: null, // Будет вычисляться
          avgVolume: null,
          speechRate: null,
        },
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
      console.log(`[LocalVoiceIdentifier] Загружено ${this.voicesDatabase.size} голосовых профилей`);
    } catch (error) {
      if (error.code === 'ENOENT') {
        this.voicesDatabase = new Map();
      } else {
        console.error('[LocalVoiceIdentifier] Ошибка загрузки:', error);
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
      console.error('[LocalVoiceIdentifier] Ошибка сохранения:', error);
    }
  }

  /**
   * Извлечение параметров голоса из аудио данных
   */
  extractAudioFeatures(audioBuffer, speechData) {
    if (!audioBuffer || audioBuffer.length < 44) {
      return null;
    }

    // Анализируем аудио буфер (WAV формат)
    const samples = [];
    for (let i = 44; i < audioBuffer.length; i += 2) {
      const sample = audioBuffer.readInt16LE(i);
      samples.push(sample);
    }

    if (samples.length === 0) return null;

    // Вычисляем средний уровень громкости
    const avgVolume = samples.reduce((sum, s) => sum + Math.abs(s), 0) / samples.length / 32768;
    
    // Вычисляем среднюю частоту (упрощенный метод через пересечения нуля)
    let zeroCrossings = 0;
    for (let i = 1; i < samples.length; i++) {
      if ((samples[i] >= 0 && samples[i-1] < 0) || (samples[i] < 0 && samples[i-1] >= 0)) {
        zeroCrossings++;
      }
    }
    const avgPitch = (zeroCrossings / 2) / (samples.length / 16000); // Примерная частота
    
    // Скорость речи (символов в секунду)
    const speechRate = speechData?.text ? speechData.text.length / (speechData.duration || 1) : null;

    return {
      avgVolume,
      avgPitch,
      speechRate,
      duration: speechData?.duration || 0,
    };
  }

  /**
   * Анализ текста на паттерны
   */
  analyzeTextPatterns(text) {
    const lowerText = text.toLowerCase();
    
    // Проверка на донаты
    for (const pattern of this.donationPatterns) {
      if (pattern.test(lowerText)) {
        return {
          type: 'donation',
          confidence: 0.9,
          reason: 'Обнаружен паттерн доната/TTS',
        };
      }
    }
    
    // Проверка на стримера
    let streamerScore = 0;
    for (const pattern of this.streamerPatterns) {
      if (pattern.test(lowerText)) {
        streamerScore += 0.3;
      }
    }
    
    // Проверка на гостя
    let guestScore = 0;
    for (const pattern of this.guestPatterns) {
      if (pattern.test(lowerText)) {
        guestScore += 0.3;
      }
    }
    
    if (streamerScore > 0.5) {
      return {
        type: 'streamer',
        confidence: Math.min(streamerScore, 0.9),
        reason: 'Обнаружены паттерны речи стримера',
      };
    }
    
    if (guestScore > 0.3) {
      return {
        type: 'guest',
        confidence: Math.min(guestScore, 0.8),
        reason: 'Обнаружены паттерны речи гостя',
      };
    }
    
    return null;
  }

  /**
   * Сравнение параметров голоса с известными профилями
   */
  compareVoiceFeatures(features, knownProfile) {
    if (!features || !knownProfile.audioFeatures) {
      return 0;
    }

    let similarity = 0;
    let factors = 0;

    // Сравнение громкости (в пределах 20%)
    if (knownProfile.audioFeatures.avgVolume && features.avgVolume) {
      const volumeDiff = Math.abs(features.avgVolume - knownProfile.audioFeatures.avgVolume);
      const volumeSimilarity = Math.max(0, 1 - (volumeDiff / 0.2));
      similarity += volumeSimilarity * 0.3;
      factors += 0.3;
    }

    // Сравнение частоты (в пределах 50 Гц)
    if (knownProfile.audioFeatures.avgPitch && features.avgPitch) {
      const pitchDiff = Math.abs(features.avgPitch - knownProfile.audioFeatures.avgPitch);
      const pitchSimilarity = Math.max(0, 1 - (pitchDiff / 50));
      similarity += pitchSimilarity * 0.4;
      factors += 0.4;
    }

    // Сравнение скорости речи (в пределах 30%)
    if (knownProfile.audioFeatures.speechRate && features.speechRate) {
      const rateDiff = Math.abs(features.speechRate - knownProfile.audioFeatures.speechRate);
      const rateSimilarity = Math.max(0, 1 - (rateDiff / (knownProfile.audioFeatures.speechRate * 0.3)));
      similarity += rateSimilarity * 0.3;
      factors += 0.3;
    }

    return factors > 0 ? similarity / factors : 0;
  }

  /**
   * Идентификация говорящего
   */
  async identifySpeaker(speechData, imageContext = null, audioBuffer = null) {
    if (!speechData || !speechData.text) {
      return {
        speaker: 'unknown',
        confidence: 0,
        type: 'unknown',
        isStreamer: false,
        shouldIgnore: true,
      };
    }

    const text = speechData.text.trim();

    // 1. Проверка на донаты по тексту
    const donationCheck = this.analyzeTextPatterns(text);
    if (donationCheck && donationCheck.type === 'donation') {
      return {
        speaker: 'donation',
        confidence: donationCheck.confidence,
        type: 'donation',
        isStreamer: false,
        shouldIgnore: true,
        reason: donationCheck.reason,
      };
    }

    // 2. Извлечение параметров голоса из аудио
    const audioFeatures = audioBuffer ? this.extractAudioFeatures(audioBuffer, speechData) : null;

    // 3. Анализ текста на паттерны
    const textAnalysis = this.analyzeTextPatterns(text);
    
    // 4. Сравнение с известными профилями
    let bestMatch = null;
    let bestScore = 0;

    for (const [id, profile] of this.voicesDatabase.entries()) {
      let score = 0;
      
      // Сравнение по тексту
      if (textAnalysis && textAnalysis.type === profile.type) {
        score += textAnalysis.confidence * 0.5;
      }
      
      // Сравнение по параметрам голоса
      if (audioFeatures) {
        const voiceSimilarity = this.compareVoiceFeatures(audioFeatures, profile);
        score += voiceSimilarity * 0.5;
      }
      
      if (score > bestScore) {
        bestScore = score;
        bestMatch = {
          id: profile.id,
          name: profile.name,
          type: profile.type,
          confidence: score,
        };
      }
    }

    // 5. Если нашли хорошее совпадение
    if (bestMatch && bestScore > 0.6) {
      // Обновляем профиль
      const profile = this.voicesDatabase.get(bestMatch.id);
      if (profile && audioFeatures) {
        // Обновляем параметры голоса (скользящее среднее)
        if (!profile.audioFeatures.avgVolume) {
          profile.audioFeatures = { ...audioFeatures };
        } else {
          profile.audioFeatures.avgVolume = (profile.audioFeatures.avgVolume * 0.7) + (audioFeatures.avgVolume * 0.3);
          if (audioFeatures.avgPitch) {
            profile.audioFeatures.avgPitch = (profile.audioFeatures.avgPitch * 0.7) + (audioFeatures.avgPitch * 0.3);
          }
          if (audioFeatures.speechRate) {
            profile.audioFeatures.speechRate = (profile.audioFeatures.speechRate * 0.7) + (audioFeatures.speechRate * 0.3);
          }
        }
        profile.lastSeen = Date.now();
        profile.examples.push({
          text: text.substring(0, 100),
          timestamp: Date.now(),
        });
        if (profile.examples.length > 10) {
          profile.examples.shift();
        }
        await this.saveVoicesDatabase();
      }

      return {
        speaker: bestMatch.id,
        confidence: bestMatch.confidence,
        type: bestMatch.type,
        isStreamer: bestMatch.id === 'streamer',
        shouldIgnore: false,
        name: bestMatch.name,
      };
    }

    // 6. Если анализ текста показал стримера или гостя, но нет точного совпадения
    if (textAnalysis && textAnalysis.type !== 'donation') {
      return {
        speaker: textAnalysis.type === 'streamer' ? 'streamer' : `guest_${Date.now()}`,
        confidence: textAnalysis.confidence,
        type: textAnalysis.type,
        isStreamer: textAnalysis.type === 'streamer',
        shouldIgnore: false,
        name: textAnalysis.type === 'streamer' ? this.streamerName : 'гость',
        isNewVoice: textAnalysis.type === 'guest',
      };
    }

    // 7. По умолчанию - неизвестный, но не игнорируем (может быть стример)
    return {
      speaker: 'unknown',
      confidence: 0.3,
      type: 'unknown',
      isStreamer: false, // Не уверены, но не игнорируем
      shouldIgnore: false, // Обрабатываем на всякий случай
      name: 'неизвестный',
    };
  }
}
