#!/usr/bin/env python3
import sys
import json
from faster_whisper import WhisperModel

audio_path = sys.argv[1]
model_size = sys.argv[2]
language = sys.argv[3]
device = sys.argv[4].lower() if len(sys.argv) > 4 else "cpu"  # Нормализуем к нижнему регистру
compute_type = sys.argv[5] if len(sys.argv) > 5 else "int8"
beam_size = int(sys.argv[6]) if len(sys.argv) > 6 else 1
best_of = int(sys.argv[7]) if len(sys.argv) > 7 else 1
temperature = float(sys.argv[8]) if len(sys.argv) > 8 else 0.0
compression_ratio_threshold = float(sys.argv[9]) if len(sys.argv) > 9 else 2.4
logprob_threshold = float(sys.argv[10]) if len(sys.argv) > 10 else -1.0
no_speech_threshold = float(sys.argv[11]) if len(sys.argv) > 11 else 0.6

try:
    # Используем переданные параметры для оптимизации скорости
    # Убеждаемся, что device в нижнем регистре
    model = WhisperModel(model_size, device=device.lower(), compute_type=compute_type)
    
    # Оптимизированные параметры для скорости
    transcribe_params = {
        "beam_size": beam_size,  # Уменьшаем для ускорения (1 = greedy, быстрее всего)
        "best_of": best_of,  # Уменьшаем для ускорения
        "temperature": temperature,  # 0 для greedy decoding (быстрее всего)
        "compression_ratio_threshold": compression_ratio_threshold,
        "log_prob_threshold": logprob_threshold,
        "no_speech_threshold": no_speech_threshold,
        "vad_filter": False,  # Отключаем VAD для ускорения
        "condition_on_previous_text": False,  # Отключаем для ускорения (не используем предыдущий контекст)
        "initial_prompt": None,  # Без промпта для ускорения
        "word_timestamps": False,  # Отключаем для ускорения
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
        # Сохраняем все сегменты для диагностики
        no_speech_prob = getattr(segment, 'no_speech_prob', 0)
        segment_text = segment.text.strip()
        
        # Сохраняем все сегменты
        all_segments.append({
            "start": segment.start,
            "end": segment.end,
            "text": segment_text,
            "no_speech_prob": no_speech_prob
        })
        
        # Добавляем в результат все сегменты с текстом
        if segment_text:
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
