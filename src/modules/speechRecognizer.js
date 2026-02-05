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
    
    this.audioCache = new Map();
  }

  async init() {
    if (this.useLocal && this.localWhisper) {
      await this.localWhisper.init();
    }
  }

  /**
   * Распознавание из буфера (потоковый режим)
   * Принимает аудио буфер и распознает речь
   */
  async recognizeFromStream(audioBuffer) {
    if (!audioBuffer || audioBuffer.length === 0) {
      console.log('[SpeechRecognizer] ⚠️ Пустой аудио буфер');
      return {
        text: null,
        confidence: 0,
        timestamp: Date.now(),
      };
    }

    console.log(`[SpeechRecognizer] 🎤 Получен аудио буфер: ${audioBuffer.length} байт (потоковый режим)`);

    try {
      // Используем локальный Whisper если включен
      if (this.useLocal && this.localWhisper) {
        console.log('[SpeechRecognizer] 🎤 Используется локальный Whisper (поток)');
        const result = await this.localWhisper.recognizeFromStream(audioBuffer);
        if (result.text) {
          console.log(`[SpeechRecognizer] ✅ РАСПОЗНАННЫЙ ТЕКСТ: "${result.text}"`);
          console.log(`[SpeechRecognizer] 📊 Уверенность: ${(result.confidence * 100).toFixed(1)}%`);
        } else {
          console.log('[SpeechRecognizer] ⚠️ Речь не распознана (пустой результат)');
        }
        return result;
      }

      // Иначе используем OpenAI API
      const tempPath = path.join(__dirname, '../../temp_audio.mp3');
      await fs.writeFile(tempPath, audioBuffer);

      const whisperModel = this.useProxyAPI 
        ? (this.config.proxyAPIWhisperModel || 'gpt-4o-transcribe')
        : 'whisper-1';
      
      console.log(`[SpeechRecognizer] 🎤 Распознавание через ${this.useProxyAPI ? 'ProxyAPI' : 'OpenAI'} (модель: ${whisperModel})`);
      const transcription = await this.openai.audio.transcriptions.create({
        file: await fs.readFile(tempPath),
        model: whisperModel,
        language: 'ru',
        response_format: 'verbose_json',
      });

      await fs.unlink(tempPath).catch(() => {});

      const result = {
        text: transcription.text,
        confidence: transcription.segments?.[0]?.no_speech_prob 
          ? 1 - transcription.segments[0].no_speech_prob 
          : 0.8,
        language: transcription.language,
        segments: transcription.segments,
        timestamp: Date.now(),
      };

      if (result.text) {
        console.log(`[SpeechRecognizer] ✅ РАСПОЗНАННЫЙ ТЕКСТ: "${result.text}"`);
        console.log(`[SpeechRecognizer] 📊 Уверенность: ${(result.confidence * 100).toFixed(1)}%, Язык: ${result.language}`);
      } else {
        console.log('[SpeechRecognizer] ⚠️ Речь не распознана (пустой результат)');
      }

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

  async recognizeFromFile(filePath) {
    try {
      const audioBuffer = await fs.readFile(filePath);
      return await this.recognizeFromStream(audioBuffer);
    } catch (error) {
      console.error('[SpeechRecognizer] Ошибка чтения файла:', error);
      return {
        text: null,
        confidence: 0,
        error: error.message,
        timestamp: Date.now(),
      };
    }
  }

  // Метод для захвата аудио из браузера (требует дополнительной реализации)
  async captureAudioFromBrowser(page) {
    // Это сложная задача, требующая использования Web Audio API
    // или специальных расширений браузера
    // В реальной реализации можно использовать:
    // 1. Puppeteer/Playwright с расширениями для захвата аудио
    // 2. Внешние инструменты типа FFmpeg для захвата системного аудио
    // 3. API Twitch для получения аудио потока напрямую
    
    console.warn('[SpeechRecognizer] Захват аудио из браузера требует дополнительной реализации');
    return null;
  }
}
