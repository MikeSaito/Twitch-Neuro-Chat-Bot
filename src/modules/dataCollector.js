import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Модуль для сбора данных обучения
 * Собирает: скриншоты, сообщения чата, речь стримера
 */
export class DataCollector {
  constructor(config = {}) {
    this.enabled = config.enabled !== false; // По умолчанию включен
    this.dataDir = path.join(__dirname, '../../training_data');
    this.screenshotsDir = path.join(this.dataDir, 'screenshots');
    this.metadataDir = path.join(this.dataDir, 'metadata');
    this.currentSession = null;
    this.sessionData = [];
  }

  async init() {
    if (!this.enabled) {
      console.log('[DataCollector] Сбор данных отключен');
      return;
    }

    try {
      // Создаем директории
      await fs.mkdir(this.dataDir, { recursive: true });
      await fs.mkdir(this.screenshotsDir, { recursive: true });
      await fs.mkdir(this.metadataDir, { recursive: true });

      // Создаем новую сессию
      this.currentSession = {
        id: `session_${Date.now()}`,
        startTime: Date.now(),
        screenshots: [],
        chatMessages: [],
        speechSegments: [],
      };

      console.log(`[DataCollector] ✅ Инициализирован. Сессия: ${this.currentSession.id}`);
      console.log(`[DataCollector] 📁 Данные сохраняются в: ${this.dataDir}`);
    } catch (error) {
      console.error('[DataCollector] Ошибка инициализации:', error);
      this.enabled = false;
    }
  }

  /**
   * Сохранить скриншот с метаданными
   */
  async saveScreenshot(screenshot, imageAnalysis, speechText, chatMessages) {
    if (!this.enabled || !this.currentSession) return;

    try {
      const timestamp = Date.now();
      const screenshotId = `screenshot_${timestamp}`;
      const screenshotPath = path.join(this.screenshotsDir, `${screenshotId}.png`);

      // Сохраняем изображение
      await fs.writeFile(screenshotPath, screenshot.buffer);

      // Создаем запись метаданных
      const metadata = {
        id: screenshotId,
        timestamp,
        sessionId: this.currentSession.id,
        screenshot: {
          path: screenshotPath,
          relativePath: `screenshots/${screenshotId}.png`,
        },
        imageAnalysis: imageAnalysis ? {
          description: imageAnalysis.description,
          confidence: imageAnalysis.confidence,
        } : null,
        speech: speechText ? {
          text: speechText.text,
          speaker: speechText.speakerName || speechText.speaker,
          isStreamer: speechText.isStreamer,
          confidence: speechText.confidence,
        } : null,
        chatContext: chatMessages ? chatMessages.map(msg => ({
          username: msg.username,
          message: msg.message,
          timestamp: msg.timestamp,
        })) : [],
      };

      // Сохраняем метаданные
      const metadataPath = path.join(this.metadataDir, `${screenshotId}.json`);
      await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8');

      // Добавляем в сессию
      this.currentSession.screenshots.push({
        id: screenshotId,
        timestamp,
        metadataPath,
      });

      // Автосохранение сессии каждые 10 скриншотов
      if (this.currentSession.screenshots.length % 10 === 0) {
        await this.saveSession();
      }

      console.log(`[DataCollector] 💾 Сохранен скриншот: ${screenshotId}`);
    } catch (error) {
      console.error('[DataCollector] Ошибка сохранения скриншота:', error);
    }
  }

  /**
   * Сохранить сообщение из чата
   */
  async saveChatMessage(username, message, timestamp = Date.now()) {
    if (!this.enabled || !this.currentSession) return;

    try {
      const chatMessage = {
        username,
        message,
        timestamp,
      };

      this.currentSession.chatMessages.push(chatMessage);

      // Храним только последние 100 сообщений в памяти
      if (this.currentSession.chatMessages.length > 100) {
        this.currentSession.chatMessages.shift();
      }
    } catch (error) {
      console.error('[DataCollector] Ошибка сохранения сообщения чата:', error);
    }
  }

  /**
   * Сохранить речь стримера
   */
  async saveSpeech(speechText) {
    if (!this.enabled || !this.currentSession) return;
    if (!speechText || !speechText.text) return;

    try {
      const speechSegment = {
        text: speechText.text,
        speaker: speechText.speakerName || speechText.speaker,
        isStreamer: speechText.isStreamer,
        confidence: speechText.confidence,
        timestamp: Date.now(),
      };

      this.currentSession.speechSegments.push(speechSegment);

      // Храним только последние 50 сегментов речи в памяти
      if (this.currentSession.speechSegments.length > 50) {
        this.currentSession.speechSegments.shift();
      }
    } catch (error) {
      console.error('[DataCollector] Ошибка сохранения речи:', error);
    }
  }

  /**
   * Сохранить сессию
   */
  async saveSession() {
    if (!this.enabled || !this.currentSession) return;

    try {
      const sessionPath = path.join(this.dataDir, `${this.currentSession.id}.json`);
      const sessionData = {
        ...this.currentSession,
        endTime: Date.now(),
        duration: Date.now() - this.currentSession.startTime,
        stats: {
          screenshotsCount: this.currentSession.screenshots.length,
          chatMessagesCount: this.currentSession.chatMessages.length,
          speechSegmentsCount: this.currentSession.speechSegments.length,
        },
      };

      await fs.writeFile(sessionPath, JSON.stringify(sessionData, null, 2), 'utf-8');
      console.log(`[DataCollector] 💾 Сессия сохранена: ${sessionPath}`);
    } catch (error) {
      console.error('[DataCollector] Ошибка сохранения сессии:', error);
    }
  }

  /**
   * Завершить сессию и сохранить
   */
  async endSession() {
    if (!this.enabled || !this.currentSession) return;

    await this.saveSession();
    console.log(`[DataCollector] ✅ Сессия завершена: ${this.currentSession.id}`);
    this.currentSession = null;
  }

  /**
   * Получить статистику сбора данных
   */
  getStats() {
    if (!this.enabled || !this.currentSession) {
      return { enabled: false };
    }

    return {
      enabled: true,
      sessionId: this.currentSession.id,
      screenshots: this.currentSession.screenshots.length,
      chatMessages: this.currentSession.chatMessages.length,
      speechSegments: this.currentSession.speechSegments.length,
      duration: Date.now() - this.currentSession.startTime,
    };
  }
}
