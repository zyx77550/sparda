# Generate the FR + EN voiceover segments with ElevenLabs.
# Usage:  XI_API_KEY=sk_...  python3 gen-voice-elevenlabs.py
# Requires:  pip install requests imageio-ffmpeg
# The key is read from the environment ONLY — never hardcode it in this file.
#
# Output: public/vo/{fr,en}-{intro,code,strike,gate,prove,outro}.wav (overwrites Kokoro).
# Voice: picks a French-labeled voice from the account's library for FR when one
# exists, else falls back to a premade multilingual voice. Settings favor
# expressiveness (low stability) — the whole point over Kokoro is emotion.

import os
import subprocess
import sys

import requests

KEY = os.environ.get('XI_API_KEY')
if not KEY:
    sys.exit('Set XI_API_KEY in the environment (never hardcode it).')

API = 'https://api.elevenlabs.io/v1'
HDR = {'xi-api-key': KEY}
MODEL = 'eleven_multilingual_v2'

SEGS = {
    'fr': [
        ('intro',  "L'IA écrit du code en trois secondes. Qui le vérifie ? Personne."),
        ('code',   "Ton agent écrit ton backend à ta place. Vite."),
        ('strike', "Et là... il vient de supprimer ta garde d'authentification."),
        ('gate',   "SPARDA le bloque. À la seconde. Hors ligne."),
        ('prove',  "Puis il compile tout ton backend... et il le prouve."),
        ('outro',  "L'IA écrit. SPARDA prouve. Une seule commande."),
    ],
    'en': [
        ('intro',  "AI writes code in three seconds. Who checks it? Nobody."),
        ('code',   "Your agent writes your backend for you. Fast."),
        ('strike', "And right there... it just removed your auth guard."),
        ('gate',   "SPARDA blocks it. Instantly. Offline."),
        ('prove',  "Then it compiles your whole backend... and proves it."),
        ('outro',  "AI writes. SPARDA proves. One command."),
    ],
}

# Segment duration caps (s) — over these, the voice overlaps the next scene.
CAPS = {'intro': 5.5, 'code': 6.5, 'strike': 4.5, 'gate': 5.5, 'prove': 7.5, 'outro': 5.5}

VOICE_SETTINGS = {
    'stability': 0.35,          # low = expressive, alive
    'similarity_boost': 0.75,
    'style': 0.35,
    'use_speaker_boost': True,
}

def pick_voices():
    voices = requests.get(f'{API}/voices', headers=HDR, timeout=30).json()['voices']
    def find(lang):
        for v in voices:
            labels = {str(x).lower() for x in (v.get('labels') or {}).values()}
            if lang in labels or (lang == 'fr' and 'french' in labels):
                return v['voice_id'], v['name']
        return None
    fr = find('fr')
    en = find('en')
    # Premade fallbacks (stable public IDs): Charlotte handles FR well on
    # multilingual v2; Brian is a solid EN narrator.
    if not fr:
        fr = ('XB0fDUnXU5powFXDhCwa', 'Charlotte (premade)')
    if not en:
        en = ('nPczCjzI2devNBz1zQrb', 'Brian (premade)')
    return {'fr': fr, 'en': en}

def ffmpeg():
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()

def wav_duration(path):
    import wave
    with wave.open(path) as w:
        return w.getnframes() / w.getframerate()

def main():
    os.makedirs('public/vo', exist_ok=True)
    voices = pick_voices()
    ff = ffmpeg()
    over = []
    for lang, (voice_id, voice_name) in voices.items():
        print(f'{lang}: voice {voice_name} ({voice_id})')
        for name, text in SEGS[lang]:
            r = requests.post(
                f'{API}/text-to-speech/{voice_id}',
                headers={**HDR, 'accept': 'audio/mpeg'},
                json={'text': text, 'model_id': MODEL, 'voice_settings': VOICE_SETTINGS},
                timeout=120,
            )
            r.raise_for_status()
            mp3 = f'public/vo/{lang}-{name}.mp3'
            wav = f'public/vo/{lang}-{name}.wav'
            with open(mp3, 'wb') as f:
                f.write(r.content)
            subprocess.run([ff, '-v', 'error', '-i', mp3, '-ar', '44100', wav, '-y'], check=True)
            os.remove(mp3)
            d = wav_duration(wav)
            flag = 'OK' if d <= CAPS[name] else 'OVER CAP — shorten the line or re-generate'
            if d > CAPS[name]:
                over.append(f'{lang}-{name}')
            print(f'  {lang}-{name:7s} {d:5.2f}s (cap {CAPS[name]}s) {flag}')
    if over:
        sys.exit(f'Segments over cap: {", ".join(over)} — fix before committing.')
    print('All 12 segments within caps.')

if __name__ == '__main__':
    main()
