import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Модуль для захвата аудио из Twitch стрима
 * Использует FFmpeg для захвата аудио потока
 */
export class AudioCapture {
  constructor(config) {
    this.config = config;
    this.isCapturing = false;
    this.ffmpegProcess = null;
    this.audioBuffer = [];
    this.tempDir = path.join(__dirname, '../../temp_audio');
  }

  async init() {
    await fs.mkdir(this.tempDir, { recursive: true });
  }

  /**
   * Захват аудио через FFmpeg из Twitch HLS потока
   * Требует установленного FFmpeg в системе
   */
  async startCapture(channel) {
    if (this.isCapturing) {
      console.warn('[AudioCapture] Захват уже запущен');
      return;
    }

    try {
      // Получаем URL HLS потока через Twitch API или напрямую
      // Это упрощенная версия - в реальности нужно получать актуальный URL потока
      const streamUrl = `https://twitch.tv/${channel}`;
      
      // Альтернативный способ: использовать streamlink или yt-dlp для получения аудио
      // streamlink --twitch-oauth-token TOKEN twitch.tv/channel audio_only -o output.mp3
      
      console.log('[AudioCapture] Запуск захвата аудио...');
      console.warn('[AudioCapture] Требуется дополнительная настройка для реального захвата аудио');
      console.warn('[AudioCapture] Рекомендуется использовать streamlink или yt-dlp');
      
      this.isCapturing = true;
    } catch (error) {
      console.error('[AudioCapture] Ошибка запуска захвата:', error);
      throw error;
    }
  }

  /**
   * Получить последний фрагмент аудио
   */
  async getAudioChunk(durationSeconds = 5) {
    // В реальной реализации здесь должен быть буфер аудио
    // Для демонстрации возвращаем null
    // В продакшене нужно использовать FFmpeg для записи и чтения аудио фрагментов
    
    return null;
  }

  /**
   * Остановка захвата
   */
  async stopCapture() {
    if (this.ffmpegProcess) {
      this.ffmpegProcess.kill();
      this.ffmpegProcess = null;
    }
    this.isCapturing = false;
    console.log('[AudioCapture] Захват остановлен');
  }

  /**
   * Альтернативный метод: использование streamlink для захвата аудио
   * Требует установки: npm install -g streamlink
   */
  async captureWithStreamlink(channel, durationSeconds = 5) {
    return new Promise((resolve, reject) => {
      const outputPath = path.join(this.tempDir, `audio_${Date.now()}.mp3`);
      
      // Команда streamlink для захвата только аудио
      const streamlink = spawn('streamlink', [
        `twitch.tv/${channel}`,
        'audio_only',
        '--twitch-oauth-token', this.config.twitchOAuthToken || '',
        '-o', outputPath,
        '--stream-segment-threads', '1',
      ]);

      let errorOutput = '';

      streamlink.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });

      streamlink.on('close', async (code) => {
        if (code === 0) {
          try {
            const audioBuffer = await fs.readFile(outputPath);
            await fs.unlink(outputPath).catch(() => {});
            resolve(audioBuffer);
          } catch (error) {
            reject(error);
          }
        } else {
          reject(new Error(`Streamlink failed: ${errorOutput}`));
        }
      });

      // Останавливаем через указанное время
      setTimeout(() => {
        streamlink.kill();
      }, durationSeconds * 1000);
    });
  }
}
