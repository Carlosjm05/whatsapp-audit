"""
══════════════════════════════════════════════════════════════
TRANSCRIBER — Pipeline de transcripción de audios con Whisper
══════════════════════════════════════════════════════════════
"""

import os
import sys
import json
import time
import uuid
import logging
import argparse
from pathlib import Path
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed

import psycopg2
import psycopg2.extras
from openai import OpenAI
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

# ─── CONFIGURACIÓN ───────────────────────────────────────────
logging.basicConfig(
    level=getattr(logging, os.getenv('LOG_LEVEL', 'INFO')),
    format='[%(asctime)s] [%(levelname)-5s] [transcriber] %(message)s',
    datefmt='%Y-%m-%dT%H:%M:%S'
)
logger = logging.getLogger(__name__)

DB_CONFIG = {
    'host': os.getenv('POSTGRES_HOST', 'localhost'),
    'port': int(os.getenv('POSTGRES_PORT', '5432')),
    'dbname': os.getenv('POSTGRES_DB', 'whatsapp_audit'),
    'user': os.getenv('POSTGRES_USER', 'wa_admin'),
    'password': os.getenv('POSTGRES_PASSWORD', ''),
}

NUM_WORKERS = int(os.getenv('NUM_WORKERS', '3'))
MAX_RETRIES = int(os.getenv('MAX_RETRIES', '3'))
CONFIDENCE_THRESHOLD = float(os.getenv('CONFIDENCE_THRESHOLD', '0.80'))
DATA_DIR = os.getenv('DATA_DIR', './data')


def get_db_connection():
    """Crear nueva conexión a PostgreSQL."""
    return psycopg2.connect(**DB_CONFIG)


def get_openai_client():
    """Crear cliente de OpenAI."""
    return OpenAI(api_key=os.getenv('OPENAI_API_KEY'))


# ─── TRANSCRIPCIÓN DE UN AUDIO ───────────────────────────────
@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=2, min=4, max=60),
    retry=retry_if_exception_type((Exception,)),
    before_sleep=lambda retry_state: logger.warning(
        f"  Reintento {retry_state.attempt_number}/3 para transcripción..."
    )
)
def transcribe_audio(client, audio_path):
    """Transcribir un archivo de audio con Whisper."""
    file_path = Path(audio_path)
    
    if not file_path.exists():
        raise FileNotFoundError(f"Audio no encontrado: {audio_path}")
    
    file_size = file_path.stat().st_size
    if file_size == 0:
        raise ValueError(f"Audio vacío: {audio_path}")
    
    # Whisper acepta máximo 25MB
    if file_size > 25 * 1024 * 1024:
        logger.warning(f"  Audio muy grande ({file_size / 1024 / 1024:.1f}MB), puede fallar")
    
    with open(audio_path, 'rb') as audio_file:
        response = client.audio.transcriptions.create(
            model="whisper-1",
            file=audio_file,
            language="es",
            response_format="verbose_json",
            timestamp_granularities=["segment"]
        )
    
    # Calcular score de confianza promedio
    confidence = 0.95  # Default alto para Whisper
    if hasattr(response, 'segments') and response.segments:
        avg_no_speech = sum(
            seg.get('no_speech_prob', 0) for seg in response.segments
        ) / len(response.segments)
        # Invertir: menor probabilidad de no-speech = mayor confianza
        confidence = max(0.0, min(1.0, 1.0 - avg_no_speech))
    
    # Calcular costo (~$0.006 USD por minuto)
    duration_minutes = (response.duration or 0) / 60.0
    cost_usd = duration_minutes * 0.006
    
    return {
        'text': response.text or '',
        'confidence': round(confidence, 3),
        'duration': response.duration,
        'cost_usd': round(cost_usd, 6),
        'language': response.language or 'es',
    }


# ─── WORKER DE TRANSCRIPCIÓN ────────────────────────────────
def process_single_transcription(task):
    """Procesar una transcripción individual (ejecutado por el worker)."""
    transcription_id = task['transcription_id']
    message_id = task['message_id']
    audio_path = task['media_path']
    
    conn = None
    try:
        openai_client = get_openai_client()
        conn = get_db_connection()
        cur = conn.cursor()
        
        # Marcar como procesando
        cur.execute(
            "UPDATE transcriptions SET status = 'processing' WHERE id = %s",
            (transcription_id,)
        )
        conn.commit()
        
        # Transcribir
        result = transcribe_audio(openai_client, audio_path)
        
        # Determinar si es baja confianza
        is_low_confidence = result['confidence'] < CONFIDENCE_THRESHOLD
        
        # Guardar resultado
        cur.execute("""
            UPDATE transcriptions SET
                transcription_text = %s,
                confidence_score = %s,
                is_low_confidence = %s,
                language = %s,
                cost_usd = %s,
                audio_duration_sec = %s,
                status = 'completed',
                processed_at = NOW(),
                error_message = NULL
            WHERE id = %s
        """, (
            result['text'],
            result['confidence'],
            is_low_confidence,
            result['language'],
            result['cost_usd'],
            result['duration'],
            transcription_id,
        ))
        conn.commit()
        
        status_icon = '⚠️' if is_low_confidence else '✅'
        logger.info(
            f"  {status_icon} Transcrito: {Path(audio_path).name} "
            f"({result['duration']:.0f}s, confianza: {result['confidence']:.2f}, "
            f"${result['cost_usd']:.4f})"
        )
        
        return {'success': True, 'cost': result['cost_usd'], 'duration': result['duration']}
        
    except Exception as e:
        logger.error(f"  ❌ Error transcribiendo {audio_path}: {str(e)}")
        
        if conn:
            try:
                cur = conn.cursor()
                cur.execute("""
                    UPDATE transcriptions SET
                        status = 'failed',
                        error_message = %s,
                        retry_count = retry_count + 1
                    WHERE id = %s
                """, (str(e)[:500], transcription_id))
                conn.commit()
            except:
                pass
        
        return {'success': False, 'error': str(e)}
    
    finally:
        if conn:
            conn.close()


# ─── OBTENER AUDIOS PENDIENTES ───────────────────────────────
def get_pending_transcriptions():
    """Obtener lista de audios que necesitan transcripción."""
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    
    cur.execute("""
        SELECT 
            t.id as transcription_id,
            t.message_id,
            m.media_path,
            m.media_duration_sec,
            rc.whatsapp_name as chat_name
        FROM transcriptions t
        JOIN messages m ON t.message_id = m.id
        JOIN raw_conversations rc ON t.conversation_id = rc.id
        WHERE t.status IN ('pending', 'failed')
        AND t.retry_count < %s
        AND m.media_path IS NOT NULL
        ORDER BY m.timestamp ASC
    """, (MAX_RETRIES,))
    
    tasks = cur.fetchall()
    conn.close()
    
    return tasks


# ─── REGISTRAR AUDIOS PENDIENTES ─────────────────────────────
def register_pending_audios():
    """Crear registros de transcripción para audios que aún no tienen."""
    conn = get_db_connection()
    cur = conn.cursor()
    
    cur.execute("""
        INSERT INTO transcriptions (id, message_id, conversation_id, audio_duration_sec, status)
        SELECT 
            uuid_generate_v4(),
            m.id,
            m.conversation_id,
            m.media_duration_sec,
            'pending'
        FROM messages m
        LEFT JOIN transcriptions t ON t.message_id = m.id
        WHERE m.message_type = 'audio'
        AND m.media_path IS NOT NULL
        AND t.id IS NULL
    """)
    
    count = cur.rowcount
    conn.commit()
    conn.close()
    
    if count > 0:
        logger.info(f"📝 {count} nuevos audios registrados para transcripción")
    
    return count


# ─── GENERAR TRANSCRIPTS UNIFICADOS ─────────────────────────
def generate_unified_transcripts():
    """
    Generar el transcript unificado de cada conversación.
    Combina mensajes de texto + transcripciones de audio en orden cronológico.
    """
    logger.info("📄 Generando transcripts unificados...")
    
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    
    # Obtener conversaciones que tienen todos los audios transcritos
    cur.execute("""
        SELECT rc.id as conversation_id, rc.whatsapp_name
        FROM raw_conversations rc
        WHERE rc.extraction_status = 'extracted'
        AND NOT EXISTS (
            SELECT 1 FROM unified_transcripts ut WHERE ut.conversation_id = rc.id
        )
        AND NOT EXISTS (
            SELECT 1 FROM messages m
            JOIN transcriptions t ON t.message_id = m.id
            WHERE m.conversation_id = rc.id
            AND m.message_type = 'audio'
            AND t.status NOT IN ('completed', 'skipped')
        )
    """)
    
    conversations = cur.fetchall()
    logger.info(f"  {len(conversations)} conversaciones listas para unificar")
    
    count = 0
    for conv in conversations:
        conv_id = conv['conversation_id']
        
        # Obtener todos los mensajes en orden
        cur.execute("""
            SELECT 
                m.timestamp,
                m.sender,
                m.message_type,
                m.body,
                m.media_duration_sec,
                t.transcription_text,
                t.is_low_confidence
            FROM messages m
            LEFT JOIN transcriptions t ON t.message_id = m.id
            WHERE m.conversation_id = %s
            AND m.message_type IN ('text', 'audio')
            ORDER BY m.timestamp ASC
        """, (conv_id,))
        
        messages = cur.fetchall()
        
        if not messages:
            continue
        
        # Construir transcript
        lines = []
        total_from_lead = 0
        total_from_asesor = 0
        total_audios = 0
        total_audios_failed = 0
        
        for msg in messages:
            ts = msg['timestamp'].strftime('%Y-%m-%d %H:%M') if msg['timestamp'] else '????-??-?? ??:??'
            sender_label = 'LEAD' if msg['sender'] == 'lead' else 'ASESOR'
            
            if msg['sender'] == 'lead':
                total_from_lead += 1
            else:
                total_from_asesor += 1
            
            if msg['message_type'] == 'text' and msg['body']:
                lines.append(f"[{ts}] {sender_label}: {msg['body']}")
            
            elif msg['message_type'] == 'audio':
                total_audios += 1
                duration = msg['media_duration_sec'] or 0
                
                if msg['transcription_text']:
                    confidence_note = " [BAJA CONFIANZA]" if msg['is_low_confidence'] else ""
                    lines.append(
                        f"[{ts}] {sender_label} (audio {duration}s{confidence_note}): "
                        f"{msg['transcription_text']}"
                    )
                else:
                    total_audios_failed += 1
                    lines.append(f"[{ts}] {sender_label} (audio {duration}s): [NO TRANSCRITO]")
        
        full_transcript = '\n\n'.join(lines)
        word_count = len(full_transcript.split())
        
        # Guardar
        cur.execute("""
            INSERT INTO unified_transcripts (
                id, conversation_id, full_transcript, total_messages,
                total_from_lead, total_from_asesor, total_audios_included,
                total_audios_failed, word_count
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (conversation_id) DO UPDATE SET
                full_transcript = EXCLUDED.full_transcript,
                total_messages = EXCLUDED.total_messages,
                total_from_lead = EXCLUDED.total_from_lead,
                total_from_asesor = EXCLUDED.total_from_asesor,
                total_audios_included = EXCLUDED.total_audios_included,
                total_audios_failed = EXCLUDED.total_audios_failed,
                word_count = EXCLUDED.word_count,
                generated_at = NOW()
        """, (
            str(uuid.uuid4()), conv_id, full_transcript, len(messages),
            total_from_lead, total_from_asesor, total_audios,
            total_audios_failed, word_count
        ))
        
        count += 1
    
    conn.commit()
    conn.close()
    
    logger.info(f"✅ {count} transcripts unificados generados")
    return count


# ─── MAIN ────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--mode', default='transcribe',
                        choices=['transcribe', 'unify', 'stats', 'full'])
    args = parser.parse_args()
    
    logger.info("══════════════════════════════════════════════")
    logger.info("  WHATSAPP AUDIT — TRANSCRIBER")
    logger.info(f"  Modo: {args.mode.upper()}")
    logger.info(f"  Workers: {NUM_WORKERS}")
    logger.info("══════════════════════════════════════════════")
    
    if args.mode in ('transcribe', 'full'):
        # Registrar audios pendientes
        register_pending_audios()
        
        # Obtener tareas
        tasks = get_pending_transcriptions()
        
        if not tasks:
            logger.info("✅ No hay audios pendientes de transcripción")
        else:
            logger.info(f"🎙️  {len(tasks)} audios pendientes de transcripción")
            
            total_cost = 0.0
            total_duration = 0.0
            success_count = 0
            fail_count = 0
            
            # Procesar con workers paralelos
            with ThreadPoolExecutor(max_workers=NUM_WORKERS) as executor:
                futures = {
                    executor.submit(process_single_transcription, task): task
                    for task in tasks
                }
                
                for future in as_completed(futures):
                    result = future.result()
                    if result['success']:
                        success_count += 1
                        total_cost += result.get('cost', 0)
                        total_duration += result.get('duration', 0)
                    else:
                        fail_count += 1
            
            logger.info("══════════════════════════════════════════════")
            logger.info("📊 RESUMEN DE TRANSCRIPCIÓN:")
            logger.info(f"   Exitosos: {success_count}")
            logger.info(f"   Fallidos: {fail_count}")
            logger.info(f"   Duración total: {total_duration/60:.1f} minutos")
            logger.info(f"   Costo total: ${total_cost:.4f} USD")
            logger.info("══════════════════════════════════════════════")
    
    if args.mode in ('unify', 'full'):
        generate_unified_transcripts()
    
    if args.mode == 'stats':
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("""
            SELECT
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE status = 'completed') as completed,
                COUNT(*) FILTER (WHERE status = 'pending') as pending,
                COUNT(*) FILTER (WHERE status = 'failed') as failed,
                COUNT(*) FILTER (WHERE is_low_confidence = true) as low_confidence,
                COALESCE(SUM(cost_usd), 0) as total_cost,
                COALESCE(SUM(audio_duration_sec), 0) as total_seconds
            FROM transcriptions
        """)
        stats = cur.fetchone()
        conn.close()
        
        logger.info("══════════════════════════════════════════════")
        logger.info("📊 ESTADÍSTICAS DE TRANSCRIPCIÓN:")
        logger.info(f"   Total: {stats['total']}")
        logger.info(f"   Completados: {stats['completed']}")
        logger.info(f"   Pendientes: {stats['pending']}")
        logger.info(f"   Fallidos: {stats['failed']}")
        logger.info(f"   Baja confianza: {stats['low_confidence']}")
        logger.info(f"   Duración total: {float(stats['total_seconds'])/60:.1f} min")
        logger.info(f"   Costo total: ${float(stats['total_cost']):.4f} USD")
        logger.info("══════════════════════════════════════════════")


if __name__ == '__main__':
    main()
