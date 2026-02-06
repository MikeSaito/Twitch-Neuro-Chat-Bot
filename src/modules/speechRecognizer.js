import OpenAI from 'openai';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { LocalWhisper } from './localWhisper.js';
import { ProxyAPI } from './proxyAPI.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class SpeechRecognizer {
  constructor(config) {
    this.config = config;
    this.useLocal = config.useLocal || false;
    this.useProxyAPI = config.useProxyAPI || false;
    
    if (this.useLocal) {
      this.localWhisper = new LocalWhisper({
        modelPath: config.localWhisperModel || 'base',
        device: config.localWhisperDevice || 'cpu',
        language: 'ru',
        computeType: config.localWhisperComputeType || 'int8',
        beamSize: config.localWhisperBeamSize || 1,
        bestOf: 1,
        temperature: 0.0, // Greedy decoding для максимальной скорости
      });
    } else if (this.useProxyAPI) {
      // Используем ProxyAPI
      this.proxyAPI = new ProxyAPI({
        apiKey: config.proxyAPIKey,
        baseUrl: config.proxyAPIBaseUrl,
        provider: config.proxyAPIProvider,
        model: config.proxyAPIWhisperModel,
      });
      this.openai = this.proxyAPI.getOpenAIClient();
      console.log('[SpeechRecognizer] Используется ProxyAPI для распознавания речи');
    } else {
      // Прямой OpenAI API
      this.openai = new OpenAI({
        apiKey: config.apiKey,
      });
    }
    
    // Накопительный буфер текста для режима реального времени
    this.realtimeTextBuffer = [];
    this.maxBufferSize = 20; // Храним последние 20 распознанных фрагментов
    this.realtimeText = ''; // Текущий полный текст
    this.lastUpdateTime = Date.now();
  }

  async init() {
    if (this.useLocal && this.localWhisper) {
      const localWhisperAvailable = await this.localWhisper.init();
      // Если локальный Whisper недоступен (скрипт не найден), переключаемся на ProxyAPI
      if (!localWhisperAvailable && this.useProxyAPI) {
        console.warn('[SpeechRecognizer] ⚠️ Локальный Whisper недоступен, переключаюсь на ProxyAPI');
        this.useLocal = false;
        this.localWhisper = null;
        // Убеждаемся, что openai инициализирован для ProxyAPI
        if (!this.openai && this.proxyAPI) {
          this.openai = this.proxyAPI.getOpenAIClient();
        }
      } else if (!localWhisperAvailable && !this.useProxyAPI) {
        console.error('[SpeechRecognizer] ❌ Локальный Whisper недоступен и ProxyAPI не включен!');
        console.error('[SpeechRecognizer] 💡 Установите USE_PROXYAPI=true в .env для использования ProxyAPI Whisper');
      }
    }
    
    // Убеждаемся, что openai инициализирован
    if (!this.openai) {
      if (this.useProxyAPI && this.proxyAPI) {
        this.openai = this.proxyAPI.getOpenAIClient();
      } else if (!this.useLocal) {
        // Используем прямой OpenAI API
        this.openai = new OpenAI({
          apiKey: this.config.apiKey,
        });
      }
    }
  }

  /**
   * Распознавание из буфера (потоковый режим)
   * Принимает аудио буфер и распознает речь
   * Обновляет накопительный буфер текста для режима реального времени
   */
  async recognizeFromStream(audioBuffer) {
    if (!audioBuffer || audioBuffer.length === 0) {
      return {
        text: null,
        confidence: 0,
        timestamp: Date.now(),
      };
    }

    try {
      let result;
      
      // Используем локальный Whisper если включен и доступен
      if (this.useLocal && this.localWhisper) {
        try {
          result = await this.localWhisper.recognizeFromStream(audioBuffer);
        } catch (error) {
          // Если локальный Whisper упал (скрипт не найден), переключаемся на ProxyAPI
          if (error.message.includes('whisper_local.py не найден') && this.useProxyAPI) {
            console.warn('[SpeechRecognizer] ⚠️ Локальный Whisper недоступен, переключаюсь на ProxyAPI');
            this.useLocal = false;
            this.localWhisper = null;
            // Продолжаем с ProxyAPI ниже
          } else {
            throw error;
          }
        }
      }
      
      // Используем ProxyAPI или OpenAI API если локальный Whisper не используется
      if (!this.useLocal || !this.localWhisper) {
        // Используем OpenAI API через память (без постоянных файлов)
        // Используем временный файл в памяти через Blob/File API если доступен
        // Иначе используем временный файл, но удаляем сразу после использования
        const whisperModel = this.useProxyAPI 
          ? (this.config.proxyAPIWhisperModel || 'gpt-4o-transcribe')
          : 'whisper-1';
        
        // OpenAI SDK требует File или путь к файлу
        // Используем временный файл, но удаляем сразу после использования
        const tempPath = path.join(__dirname, '../../temp_audio.mp3');
        await fs.writeFile(tempPath, audioBuffer);
        
        try {
          const transcription = await this.openai.audio.transcriptions.create({
            file: await fs.readFile(tempPath),
            model: whisperModel,
            language: 'ru',
            response_format: 'verbose_json',
          });

          result = {
            text: transcription.text,
            confidence: transcription.segments?.[0]?.no_speech_prob 
              ? 1 - transcription.segments[0].no_speech_prob 
              : 0.8,
            language: transcription.language,
            segments: transcription.segments,
            timestamp: Date.now(),
          };
        } finally {
          // Удаляем файл сразу после использования
          await fs.unlink(tempPath).catch(() => {});
        }
      }
      
      // НЕ обновляем накопительный буфер здесь - это будет сделано в coordinator
      // после идентификации говорящего и фильтрации (только стример, не донаты)
      // Буфер обновляется через updateRealtimeTextBuffer из coordinator

      return result;
    } catch (error) {
      console.error('[SpeechRecognizer] Ошибка распознавания:', error);
      return {
        text: null,
        confidence: 0,
        error: error.message,
        timestamp: Date.now(),
      };
    }
  }
  
  /**
   * Обновление накопительного буфера текста
   */
  updateRealtimeTextBuffer(text, timestamp) {
    // Добавляем новый фрагмент
    this.realtimeTextBuffer.push({
      text: text.trim(),
      timestamp: timestamp || Date.now(),
    });
    
    // Ограничиваем размер буфера
    if (this.realtimeTextBuffer.length > this.maxBufferSize) {
      this.realtimeTextBuffer.shift();
    }
    
    // Обновляем полный текст (последние N фрагментов)
    this.realtimeText = this.realtimeTextBuffer
      .slice(-this.maxBufferSize)
      .map(item => item.text)
      .join(' ');
    
    this.lastUpdateTime = Date.now();
  }
  
  /**
   * Получить текущий накопительный текст (для мозга)
   * @param {number} lastSeconds - Получить текст за последние N секунд (по умолчанию все)
   * @returns {string} Текущий текст
   */
  getCurrentText(lastSeconds = null) {
    if (!lastSeconds) {
      return this.realtimeText;
    }
    
    const cutoffTime = Date.now() - (lastSeconds * 1000);
    const recentFragments = this.realtimeTextBuffer.filter(
      item => item.timestamp >= cutoffTime
    );
    
    return recentFragments.map(item => item.text).join(' ');
  }
  
  /**
   * Получить последние N фрагментов текста
   * @param {number} count - Количество фрагментов
   * @returns {Array} Массив фрагментов с текстом и временем
   */
  getRecentFragments(count = 5) {
    return this.realtimeTextBuffer.slice(-count);
  }
  
  /**
   * Очистить буфер текста
   */
  clearTextBuffer() {
    this.realtimeTextBuffer = [];
    this.realtimeText = '';
    this.lastUpdateTime = Date.now();
  }
}
