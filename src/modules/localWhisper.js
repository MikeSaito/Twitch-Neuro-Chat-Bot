import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Локальный Whisper для распознавания речи
 * Использует faster-whisper
 */
export class LocalWhisper {
  constructor(config = {}) {
    this.modelPath = config.modelPath || 'base'; // base, small, medium, large
    this.useFasterWhisper = config.useFasterWhisper !== false; // По умолчанию faster-whisper
    this.device = (config.device || 'cpu').toLowerCase(); // cpu или cuda (всегда строчными)
    this.language = config.language || 'ru';
    this.fallbackModel = null; // Модель для fallback при ошибке памяти
    // Иерархия моделей от большей к меньшей (включая версии)
    this.modelHierarchy = ['large-v3', 'large-v2', 'large', 'medium', 'small', 'base', 'tiny'];
    
    // Оптимизация для скорости
    this.computeType = config.computeType || 'int8'; // int8, int8_float16, float16, float32
    this.beamSize = config.beamSize || 1; // Уменьшаем beam_size для ускорения (было 5)
    this.bestOf = config.bestOf || 1; // Уменьшаем best_of для ускорения
    this.temperature = config.temperature || 0; // Используем greedy decoding для скорости
    this.compressionRatioThreshold = config.compressionRatioThreshold || 2.4; // Порог для фильтрации
    this.logProbThreshold = config.logProbThreshold || -1.0; // Порог вероятности
    this.noSpeechThreshold = config.noSpeechThreshold || 0.6; // Порог для определения речи
    
    // Флаг для отслеживания попытки CUDA
    this.cudaAttempted = false;
  }

  async init() {
    if (this.useFasterWhisper) {
      try {
        // Проверяем наличие faster-whisper
        await execAsync('python -c "import faster_whisper"');
        console.log('[LocalWhisper] faster-whisper найден');
        
        // Проверяем наличие скрипта
        const scriptPath = path.join(__dirname, '../../scripts/whisper_local.py');
        try {
          await fs.access(scriptPath);
          console.log('[LocalWhisper] ✅ Скрипт whisper_local.py найден');
          return true;
        } catch {
          console.warn('[LocalWhisper] ⚠️ Скрипт whisper_local.py не найден');
          console.warn('[LocalWhisper] 💡 Рекомендуется использовать ProxyAPI для Whisper');
          return false; // Возвращаем false, чтобы переключиться на ProxyAPI
        }
      } catch (error) {
        console.warn('[LocalWhisper] faster-whisper не найден. Установите: pip install faster-whisper');
        return false;
      }
    }
    return true;
  }

  async recognizeFromStream(audioBuffer) {
    if (!audioBuffer || audioBuffer.length === 0) {
      return {
        text: null,
        confidence: 0,
        timestamp: Date.now(),
      };
    }

    // Если CUDA уже не работала, сразу используем CPU
    if (this.cudaAttempted && this.device === 'cuda') {
      this.device = 'cpu';
      if (this.computeType === 'int8_float16') {
        this.computeType = 'int8';
      }
    }

    try {
      // Используем системную временную директорию для избежания проблем с кириллицей в путях
      const tempDir = os.tmpdir();
      const tempMp3Path = path.join(tempDir, `twitch_bot_audio_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.mp3`);
      const tempWavPath = path.join(tempDir, `twitch_bot_audio_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.wav`);
      
      await fs.writeFile(tempMp3Path, audioBuffer);

      // Конвертируем MP3 в WAV через ffmpeg с оптимизированными настройками для скорости
      try {
        // Оптимизированные параметры: 16kHz моно, минимальная обработка для скорости
        // Убираем фильтры для ускорения - faster-whisper сам обработает
        // Используем более быстрый кодек и меньше обработки
        const ffmpegCommand = `ffmpeg -i "${tempMp3Path}" -ar 16000 -ac 1 -f wav "${tempWavPath}" -y -loglevel error -threads 2`;
        await execAsync(ffmpegCommand, { timeout: 3000 }); // Таймаут 3 секунды
      } catch (ffmpegError) {
        console.warn('[LocalWhisper] ⚠️ Ошибка конвертации через ffmpeg, пробую использовать MP3 напрямую:', ffmpegError.message);
        // Если ffmpeg не работает, пробуем использовать MP3 напрямую
        // faster-whisper поддерживает MP3, но WAV надежнее
        const tempPath = tempMp3Path;
        let result;
        if (this.useFasterWhisper) {
          result = await this.recognizeWithFasterWhisper(tempPath);
        } else {
          result = await this.recognizeWithWhisperCpp(tempPath);
        }
        await fs.unlink(tempMp3Path).catch(() => {});
        return result;
      }

      // Используем WAV файл для распознавания
      let result;
      if (this.useFasterWhisper) {
        result = await this.recognizeWithFasterWhisper(tempWavPath);
      } else {
        result = await this.recognizeWithWhisperCpp(tempWavPath);
      }

      // Удаляем временные файлы
      await fs.unlink(tempMp3Path).catch(() => {});
      await fs.unlink(tempWavPath).catch(() => {});

      return result;
    } catch (error) {
      console.error('[LocalWhisper] Ошибка распознавания:', error);
      return {
        text: null,
        confidence: 0,
        error: error.message,
        timestamp: Date.now(),
      };
    }
  }

  async recognizeWithFasterWhisper(audioPath, modelToUse = null, deviceToUse = null) {
    const currentModel = modelToUse || this.modelPath;
    // Нормализуем устройство к нижнему регистру
    const currentDevice = (deviceToUse || this.device).toLowerCase();
    
    try {
      // Используем Python скрипт для faster-whisper
      const scriptPath = path.join(__dirname, '../../scripts/whisper_local.py');
      
      // Проверяем наличие скрипта
      const scriptExists = await this.ensureWhisperScript(scriptPath);
      if (!scriptExists) {
        throw new Error('Скрипт whisper_local.py не найден. Используйте ProxyAPI для Whisper (установите USE_LOCAL_WHISPER=false в .env)');
      }

      // Определяем compute_type для текущего устройства
      // Для CPU используем int8, для CUDA можно использовать int8_float16
      let computeTypeToUse = this.computeType;
      // Нормализуем устройство к нижнему регистру
      const normalizedDevice = currentDevice.toLowerCase();
      if (normalizedDevice === 'cpu' && computeTypeToUse === 'int8_float16') {
        computeTypeToUse = 'int8';
      }
      
      // Передаем дополнительные параметры оптимизации
      // Используем нормализованное устройство (всегда строчными буквами)
      const command = `python "${scriptPath}" "${audioPath}" "${currentModel}" "${this.language}" "${normalizedDevice}" "${computeTypeToUse}" "${this.beamSize}" "${this.bestOf}" "${this.temperature}" "${this.compressionRatioThreshold}" "${this.logProbThreshold}" "${this.noSpeechThreshold}"`;
      // Увеличиваем таймаут до 120 секунд для загрузки модели и обработки (особенно для больших моделей)
      const { stdout, stderr } = await execAsync(command, { timeout: 120000 }); // Таймаут 120 секунд
      
      if (stderr && !stderr.includes('WARNING')) {
        console.warn(`[LocalWhisper] stderr: ${stderr}`);
      }
      
      const result = JSON.parse(stdout);
      
      if (result.error) {
        // Проверяем, является ли ошибка ошибкой CUDA
        const isCudaError = result.error.includes('cublas') || 
                           result.error.includes('cuda') ||
                           result.error.includes('CUDA') ||
                           result.error.includes('.dll is not found') ||
                           result.error.includes('cannot be loaded');
        
        // Проверяем, является ли ошибка ошибкой памяти
        const isMemoryError = result.error.includes('mkl_malloc') || 
                              result.error.includes('failed to allocate memory') ||
                              result.error.includes('out of memory') ||
                              result.error.includes('MemoryError');
        
        // Если ошибка CUDA и мы используем CUDA - переключаемся на CPU
        if (isCudaError && currentDevice === 'cuda') {
          console.warn(`[LocalWhisper] ⚠️ CUDA недоступна: ${result.error}`);
          console.log(`[LocalWhisper] 🔄 Переключаюсь на CPU`);
          
          // Сохраняем fallback на CPU
          this.device = 'cpu';
          // Для CPU используем int8 вместо int8_float16
          if (this.computeType === 'int8_float16') {
            this.computeType = 'int8';
          }
          this.cudaAttempted = true;
          
          // Пробуем с CPU
          return await this.recognizeWithFasterWhisper(audioPath, currentModel, 'cpu');
        }
        
        if (isMemoryError) {
          console.warn(`[LocalWhisper] ⚠️ Недостаточно памяти для модели "${currentModel}"`);
          
          // Находим следующую меньшую модель
          // Если модель с версией (например, large-v3), ищем по базовому имени
          const baseModel = currentModel.replace(/-v\d+$/, ''); // Убираем версию
          let currentIndex = this.modelHierarchy.indexOf(currentModel);
          if (currentIndex < 0) {
            // Если точного совпадения нет, ищем по базовому имени
            currentIndex = this.modelHierarchy.findIndex(m => m.startsWith(baseModel));
          }
          
          if (currentIndex >= 0 && currentIndex < this.modelHierarchy.length - 1) {
            const nextModel = this.modelHierarchy[currentIndex + 1];
            console.log(`[LocalWhisper] 🔄 Переключаюсь на меньшую модель: ${nextModel}`);
            
            // Сохраняем fallback модель для будущего использования
            this.fallbackModel = nextModel;
            // Обновляем основную модель для будущих вызовов
            this.modelPath = nextModel;
            
            // Для меньшей модели используем int8 вместо float32 для экономии памяти
            if (this.computeType === 'float32') {
              this.computeType = 'int8';
              console.log(`[LocalWhisper] 🔄 Переключаюсь на int8 вместо float32 для экономии памяти`);
            }
            
            // Пробуем с меньшей моделью
            return await this.recognizeWithFasterWhisper(audioPath, nextModel, currentDevice);
          } else {
            console.error(`[LocalWhisper] ❌ Не удалось использовать даже самую маленькую модель`);
            throw new Error(`Недостаточно памяти для модели ${currentModel}`);
          }
        } else {
          console.error(`[LocalWhisper] ❌ Ошибка: ${result.error}`);
          throw new Error(result.error);
        }
      }
      
      // Если успешно использовали fallback модель, обновляем основную
      if (currentModel !== this.modelPath && this.fallbackModel) {
        console.log(`[LocalWhisper] ✅ Успешно использована модель ${currentModel} (вместо ${this.modelPath})`);
        this.modelPath = currentModel; // Обновляем модель для будущих вызовов
      }
      
      return {
        text: result.text || null,
        confidence: result.confidence || 0.8,
        language: result.language || this.language,
        segments: result.segments || [],
        timestamp: Date.now(),
      };
    } catch (error) {
      // Проверяем, является ли ошибка таймаутом (SIGTERM)
      if (error.signal === 'SIGTERM' || error.killed === true) {
        console.warn(`[LocalWhisper] ⚠️ Таймаут для модели "${currentModel}" (процесс был убит)`);
        
        // Находим следующую меньшую модель
        const baseModel = currentModel.replace(/-v\d+$/, '');
        let currentIndex = this.modelHierarchy.indexOf(currentModel);
        if (currentIndex < 0) {
          currentIndex = this.modelHierarchy.findIndex(m => m.startsWith(baseModel));
        }
        
        if (currentIndex >= 0 && currentIndex < this.modelHierarchy.length - 1) {
          const nextModel = this.modelHierarchy[currentIndex + 1];
          console.log(`[LocalWhisper] 🔄 Переключаюсь на меньшую модель из-за таймаута: ${nextModel}`);
          
          this.fallbackModel = nextModel;
          this.modelPath = nextModel;
          
          // Для меньшей модели используем int8 вместо float32
          if (this.computeType === 'float32') {
            this.computeType = 'int8';
            console.log(`[LocalWhisper] 🔄 Переключаюсь на int8 вместо float32 для экономии памяти`);
          }
          
          // Пробуем с меньшей моделью
          return await this.recognizeWithFasterWhisper(audioPath, nextModel, currentDevice);
        } else {
          console.error(`[LocalWhisper] ❌ Таймаут даже для самой маленькой модели`);
          throw new Error(`Таймаут для модели ${currentModel}`);
        }
      }
      
      // Проверяем, является ли ошибка ошибкой памяти в stdout
      let stdoutText = '';
      if (error.stdout) {
        stdoutText = typeof error.stdout === 'string' ? error.stdout : error.stdout.toString();
      }
      
      if (stdoutText) {
        try {
          const parsed = JSON.parse(stdoutText.trim());
          if (parsed.error) {
            const isMemoryError = parsed.error.includes('mkl_malloc') || 
                                  parsed.error.includes('failed to allocate memory') ||
                                  parsed.error.includes('out of memory') ||
                                  parsed.error.includes('MemoryError');
            
            if (isMemoryError) {
              console.warn(`[LocalWhisper] ⚠️ Недостаточно памяти для модели "${currentModel}"`);
              
              // Находим следующую меньшую модель
              // Если модель с версией (например, large-v3), ищем по базовому имени
              const baseModel = currentModel.replace(/-v\d+$/, ''); // Убираем версию
              let currentIndex = this.modelHierarchy.indexOf(currentModel);
              if (currentIndex < 0) {
                // Если точного совпадения нет, ищем по базовому имени
                currentIndex = this.modelHierarchy.findIndex(m => m.startsWith(baseModel));
              }
              
              if (currentIndex >= 0 && currentIndex < this.modelHierarchy.length - 1) {
                const nextModel = this.modelHierarchy[currentIndex + 1];
                console.log(`[LocalWhisper] 🔄 Переключаюсь на меньшую модель: ${nextModel}`);
                
                // Сохраняем fallback модель
                this.fallbackModel = nextModel;
                // Обновляем основную модель для будущих вызовов
                this.modelPath = nextModel;
                
                // Для меньшей модели используем int8 вместо float32
                if (this.computeType === 'float32') {
                  this.computeType = 'int8';
                  console.log(`[LocalWhisper] 🔄 Переключаюсь на int8 вместо float32 для экономии памяти`);
                }
                
                // Пробуем с меньшей моделью
                return await this.recognizeWithFasterWhisper(audioPath, nextModel, currentDevice);
              } else {
                // Если даже самая маленькая модель не работает - выбрасываем ошибку
                console.error(`[LocalWhisper] ❌ Не удалось использовать даже самую маленькую модель`);
                throw new Error(`Недостаточно памяти для модели ${currentModel}`);
              }
            }
            
            // Проверяем ошибку CUDA
            const isCudaError = parsed.error.includes('cublas') || 
                               parsed.error.includes('cuda') ||
                               parsed.error.includes('CUDA') ||
                               parsed.error.includes('.dll is not found') ||
                               parsed.error.includes('cannot be loaded');
            
            // currentDevice уже нормализован к нижнему регистру
            if (isCudaError && currentDevice === 'cuda') {
              console.warn(`[LocalWhisper] ⚠️ CUDA недоступна: ${parsed.error}`);
              console.log(`[LocalWhisper] 🔄 Переключаюсь на CPU`);
              
              // Сохраняем fallback на CPU
              this.device = 'cpu';
              // Для CPU используем int8 вместо int8_float16
              if (this.computeType === 'int8_float16') {
                this.computeType = 'int8';
              }
              this.cudaAttempted = true;
              
              // Пробуем с CPU (всегда строчными буквами)
              return await this.recognizeWithFasterWhisper(audioPath, currentModel, 'cpu');
            }
          }
        } catch (parseError) {
          // Игнорируем ошибки парсинга
        }
      }
      
      console.error('[LocalWhisper] ❌ Ошибка faster-whisper:', error.message);
      if (error.stdout) {
        console.error('[LocalWhisper] stdout:', error.stdout);
      }
      if (error.stderr) {
        console.error('[LocalWhisper] stderr:', error.stderr);
      }
      throw error;
    }
  }

  async recognizeWithWhisperCpp(audioPath) {
    // Реализация для whisper.cpp (требует установки whisper.cpp)
    console.warn('[LocalWhisper] whisper.cpp не реализован, используйте faster-whisper');
    throw new Error('whisper.cpp не реализован');
  }

  async ensureWhisperScript(scriptPath) {
    try {
      await fs.access(scriptPath);
      // Файл существует, все хорошо
      return true;
    } catch {
      console.warn(`[LocalWhisper] ⚠️ Скрипт не найден: ${scriptPath}`);
      console.warn('[LocalWhisper] Убедитесь, что файл scripts/whisper_local.py существует');
      console.warn('[LocalWhisper] 💡 Или переключитесь на ProxyAPI: установите USE_LOCAL_WHISPER=false в .env');
      return false;
    }
  }
}
