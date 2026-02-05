import { spawn } from 'child_process';
import { EventEmitter } from 'events';

/**
 * Voice Activity Detection (VAD) - определение активности речи
 * Анализирует аудио поток и определяет начало и конец речи
 */
export class VoiceActivityDetector extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      // Порог громкости для определения речи (0-1)
      volumeThreshold: config.volumeThreshold || 0.01,
      // Минимальная длительность речи в секундах
      minSpeechDuration: config.minSpeechDuration || 0.5,
      // Время тишины после речи для определения конца (секунды)
      silenceDuration: config.silenceDuration || 1.0,
      // Частота дискретизации
      sampleRate: config.sampleRate || 16000,
      // Размер буфера для анализа (секунды)
      bufferSize: config.bufferSize || 0.1,
    };
    
    this.isSpeechActive = false;
    this.speechStartTime = null;
    this.lastSpeechTime = null;
    this.audioBuffer = [];
    this.ffmpegProcess = null;
  }

  /**
   * Запуск анализа аудио потока через ffmpeg
   * @param {string} streamUrl - URL стрима
   */
  startAnalysis(streamUrl) {
    return new Promise((resolve, reject) => {
      // Используем ffmpeg для анализа уровня громкости в реальном времени
      const ffmpegArgs = [
        '-i', streamUrl,
        '-vn', // Без видео
        '-af', `volumedetect`, // Анализ громкости
        '-f', 'null', // Не сохраняем файл
        '-', // Вывод в stdout
      ];

      console.log('[VAD] 🎤 Запуск анализа активности речи...');
      this.ffmpegProcess = spawn('ffmpeg', ffmpegArgs);

      let errorOutput = '';
      let hasStarted = false;

      this.ffmpegProcess.stderr.on('data', (data) => {
        const text = data.toString();
        errorOutput += text;
        
        // Парсим вывод ffmpeg для определения уровня громкости
        // ffmpeg выводит: mean_volume: -XX.X dB
        const volumeMatch = text.match(/mean_volume:\s*(-?\d+\.?\d*)\s*dB/);
        if (volumeMatch) {
          const volumeDb = parseFloat(volumeMatch[1]);
          const volumeLinear = this.dbToLinear(volumeDb);
          
          this.processVolumeSample(volumeLinear);
        }
        
        // Определяем начало процесса
        if (text.includes('Stream #') && !hasStarted) {
          hasStarted = true;
          console.log('[VAD] ✅ Анализ начат');
          resolve();
        }
      });

      this.ffmpegProcess.on('error', (error) => {
        console.error('[VAD] Ошибка запуска ffmpeg:', error.message);
        reject(error);
      });

      this.ffmpegProcess.on('close', (code) => {
        console.log(`[VAD] 🔚 Процесс анализа завершен (код: ${code})`);
        this.cleanup();
      });
    });
  }

  /**
   * Альтернативный метод: анализ через захват небольших фрагментов
   * Более точный, но требует больше ресурсов
   */
  async analyzeStreamChunks(streamUrl, onChunk) {
    const chunkDuration = 0.5; // 0.5 секунды на чанк
    let chunkIndex = 0;
    
    while (true) {
      try {
        const chunk = await this.captureChunk(streamUrl, chunkDuration, chunkIndex);
        if (!chunk) break;
        
        const hasSpeech = await this.analyzeChunk(chunk);
        onChunk(chunk, hasSpeech);
        
        chunkIndex++;
      } catch (error) {
        console.error('[VAD] Ошибка анализа чанка:', error.message);
        break;
      }
    }
  }

  /**
   * Захват небольшого фрагмента аудио
   */
  async captureChunk(streamUrl, duration, offset = 0) {
    return new Promise((resolve, reject) => {
      const tempPath = path.join(os.tmpdir(), `vad_chunk_${Date.now()}.wav`);
      
      const ffmpegArgs = [
        '-ss', `${offset}`, // Смещение
        '-i', streamUrl,
        '-t', `${duration}`, // Длительность
        '-vn',
        '-ar', '16000',
        '-ac', '1',
        '-f', 'wav',
        '-y',
        tempPath
      ];

      const ffmpeg = spawn('ffmpeg', ffmpegArgs);
      let errorOutput = '';

      ffmpeg.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });

      ffmpeg.on('close', async (code) => {
        if (code === 0) {
          try {
            const fs = require('fs/promises');
            const buffer = await fs.readFile(tempPath);
            await fs.unlink(tempPath).catch(() => {});
            resolve(buffer);
          } catch (error) {
            reject(error);
          }
        } else {
          reject(new Error(`FFmpeg failed: ${errorOutput}`));
        }
      });

      ffmpeg.on('error', reject);
    });
  }

  /**
   * Анализ чанка на наличие речи
   * Использует простой анализ уровня громкости
   */
  async analyzeChunk(audioBuffer) {
    // Простой анализ: проверяем средний уровень громкости
    // В реальной реализации можно использовать более сложные алгоритмы
    const samples = this.bufferToSamples(audioBuffer);
    const avgVolume = this.calculateAverageVolume(samples);
    
    return avgVolume > this.config.volumeThreshold;
  }

  /**
   * Обработка образца громкости
   */
  processVolumeSample(volumeLinear) {
    const now = Date.now();
    const hasSpeech = volumeLinear > this.config.volumeThreshold;

    if (hasSpeech) {
      if (!this.isSpeechActive) {
        // Начало речи
        this.isSpeechActive = true;
        this.speechStartTime = now;
        this.audioBuffer = [];
        console.log('[VAD] 🎤 Начало речи обнаружено');
        this.emit('speechStart', { timestamp: now });
      }
      this.lastSpeechTime = now;
    } else {
      if (this.isSpeechActive) {
        // Проверяем, закончилась ли речь (тишина дольше silenceDuration)
        const silenceDuration = (now - this.lastSpeechTime) / 1000;
        if (silenceDuration >= this.config.silenceDuration) {
          // Конец речи
          const speechDuration = (now - this.speechStartTime) / 1000;
          if (speechDuration >= this.config.minSpeechDuration) {
            console.log(`[VAD] ✅ Конец речи обнаружен (длительность: ${speechDuration.toFixed(2)}с)`);
            this.emit('speechEnd', {
              timestamp: now,
              duration: speechDuration,
              audioBuffer: Buffer.concat(this.audioBuffer),
            });
          }
          this.isSpeechActive = false;
          this.speechStartTime = null;
          this.audioBuffer = [];
        }
      }
    }
  }

  /**
   * Конвертация dB в линейное значение (0-1)
   */
  dbToLinear(db) {
    return Math.pow(10, db / 20);
  }

  /**
   * Конвертация буфера в массив сэмплов
   */
  bufferToSamples(buffer) {
    const samples = [];
    for (let i = 0; i < buffer.length; i += 2) {
      const sample = buffer.readInt16LE(i);
      samples.push(Math.abs(sample) / 32768);
    }
    return samples;
  }

  /**
   * Расчет среднего уровня громкости
   */
  calculateAverageVolume(samples) {
    if (samples.length === 0) return 0;
    const sum = samples.reduce((a, b) => a + b, 0);
    return sum / samples.length;
  }

  /**
   * Остановка анализа
   */
  stop() {
    if (this.ffmpegProcess && !this.ffmpegProcess.killed) {
      this.ffmpegProcess.kill();
    }
    this.cleanup();
  }

  cleanup() {
    this.isSpeechActive = false;
    this.speechStartTime = null;
    this.lastSpeechTime = null;
    this.audioBuffer = [];
    this.ffmpegProcess = null;
  }
}
