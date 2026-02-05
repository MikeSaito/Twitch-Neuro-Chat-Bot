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
 * Использует faster-whisper или whisper.cpp
 */
export class LocalWhisper {
  constructor(config = {}) {
    this.modelPath = config.modelPath || 'base'; // base, small, medium, large
    this.useFasterWhisper = config.useFasterWhisper !== false; // По умолчанию faster-whisper
    this.device = config.device || 'cpu'; // cpu или cuda
    this.language = config.language || 'ru';
  }

  async init() {
    if (this.useFasterWhisper) {
      try {
        // Проверяем наличие faster-whisper
        await execAsync('python -c "import faster_whisper"');
        console.log('[LocalWhisper] faster-whisper найден');
        return true;
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

    try {
      // Используем системную временную директорию для избежания проблем с кириллицей в путях
      const tempDir = os.tmpdir();
      const tempMp3Path = path.join(tempDir, `twitch_bot_audio_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.mp3`);
      const tempWavPath = path.join(tempDir, `twitch_bot_audio_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.wav`);
      
      console.log(`[LocalWhisper] 💾 Сохранение аудио: ${audioBuffer.length} байт`);
      await fs.writeFile(tempMp3Path, audioBuffer);

      // Конвертируем MP3 в WAV через ffmpeg с улучшенными настройками для лучшего качества
      console.log('[LocalWhisper] 🔄 Конвертация MP3 → WAV через ffmpeg (оптимизация качества)...');
      try {
        // Улучшенные параметры: 16kHz моно, высокое качество, нормализация
        const ffmpegCommand = `ffmpeg -i "${tempMp3Path}" -ar 16000 -ac 1 -af "highpass=f=80,lowpass=f=8000,volume=1.2" -f wav "${tempWavPath}" -y`;
        await execAsync(ffmpegCommand);
        console.log('[LocalWhisper] ✅ Конвертация завершена (оптимизировано для распознавания)');
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

  async recognizeWithFasterWhisper(audioPath) {
    try {
      // Используем Python скрипт для faster-whisper
      const scriptPath = path.join(__dirname, '../../scripts/whisper_local.py');
      
      // Создаем скрипт если его нет
      await this.ensureWhisperScript(scriptPath);

      console.log(`[LocalWhisper] 🎤 Запуск faster-whisper (модель: ${this.modelPath}, язык: ${this.language})...`);
      const command = `python "${scriptPath}" "${audioPath}" "${this.modelPath}" "${this.language}" "${this.device}"`;
      const { stdout, stderr } = await execAsync(command);
      
      if (stderr) {
        console.log(`[LocalWhisper] stderr: ${stderr}`);
      }
      
      const result = JSON.parse(stdout);
      
      if (result.error) {
        console.error(`[LocalWhisper] ❌ Ошибка в Python скрипте: ${result.error}`);
        throw new Error(result.error);
      }
      
      console.log(`[LocalWhisper] ✅ Распознавание завершено. Текст: "${result.text || '(пусто)'}"`);
      
      // Диагностика: показываем информацию о сегментах
      if (result.segments && result.segments.length > 0) {
        console.log(`[LocalWhisper] 📊 Найдено сегментов: ${result.segments.length}`);
        result.segments.forEach((seg, idx) => {
          const textPreview = seg.text ? `"${seg.text.substring(0, 50)}${seg.text.length > 50 ? '...' : ''}"` : '(пусто)';
          console.log(`[LocalWhisper]    Сегмент ${idx + 1} [${seg.start?.toFixed(1)}s-${seg.end?.toFixed(1)}s]: ${textPreview} (no_speech: ${seg.no_speech_prob?.toFixed(2) || 'N/A'})`);
        });
      } else {
        console.log(`[LocalWhisper] ⚠️ Сегменты не найдены (возможно, только тишина)`);
      }
      
      if (!result.text && result.segments && result.segments.length > 0) {
        console.log(`[LocalWhisper] ⚠️ Сегменты найдены, но текст пустой. Возможно, все сегменты отфильтрованы.`);
      }
      
      return {
        text: result.text || null,
        confidence: result.confidence || 0.8,
        language: result.language || this.language,
        segments: result.segments || [],
        timestamp: Date.now(),
      };
    } catch (error) {
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
    } catch {
      // Создаем скрипт
      const scriptDir = path.dirname(scriptPath);
      await fs.mkdir(scriptDir, { recursive: true });

      const script = `#!/usr/bin/env python3
import sys
import json
from faster_whisper import WhisperModel

audio_path = sys.argv[1]
model_size = sys.argv[2]
language = sys.argv[3]
device = sys.argv[4]

try:
    model = WhisperModel(model_size, device=device, compute_type="int8")
    # Отключаем VAD фильтр и используем auto-detect языка для лучшего распознавания
    # Если язык указан, используем его, иначе auto-detect
    transcribe_params = {
        "beam_size": 5,
        "vad_filter": False,  # Отключаем VAD фильтр для теста
        "vad_parameters": {"threshold": 0.3}  # Более мягкий порог VAD если нужен
    }
    if language and language != "auto":
        transcribe_params["language"] = language
    segments, info = model.transcribe(audio_path, **transcribe_params)
    
    text_parts = []
    all_segments = []
    total_confidence = 0
    count = 0
    has_speech = False
    
    for segment in segments:
        # Сохраняем все сегменты для диагностики, но фильтруем по no_speech_prob
        no_speech_prob = getattr(segment, 'no_speech_prob', 0)
        segment_text = segment.text.strip()
        
        # Сохраняем все сегменты (даже с тишиной) для диагностики
        all_segments.append({
            "start": segment.start,
            "end": segment.end,
            "text": segment_text,
            "no_speech_prob": no_speech_prob
        })
        
        # Добавляем в результат все сегменты с текстом (убрали фильтр по no_speech_prob для теста)
        if segment_text:  # Добавляем все сегменты с текстом
            has_speech = True
            text_parts.append(segment_text)
            if hasattr(segment, 'avg_logprob'):
                total_confidence += segment.avg_logprob
                count += 1
    
    text = " ".join(text_parts).strip()
    
    # Если нет речи, возвращаем пустой текст
    if not has_speech or not text:
        result = {
            "text": "",
            "confidence": 0,
            "language": info.language if hasattr(info, 'language') else language,
            "segments": all_segments
        }
    else:
        confidence = 1.0 + (total_confidence / count if count > 0 else 0)
        confidence = max(0, min(1, confidence))
        
        result = {
            "text": text,
            "confidence": confidence,
            "language": info.language if hasattr(info, 'language') else language,
            "segments": all_segments
        }
    
    print(json.dumps(result))
except Exception as e:
    print(json.dumps({"error": str(e), "text": "", "confidence": 0}))
    sys.exit(1)
`;

      await fs.writeFile(scriptPath, script);
      console.log('[LocalWhisper] Создан Python скрипт для faster-whisper');
    }
  }
}
