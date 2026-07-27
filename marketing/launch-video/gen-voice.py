# Generate the FR + EN voiceover segments with Kokoro (Apache-2.0).
# FR voice: ff_siwis. EN voice: af_heart (Kokoro's best English).
import soundfile as sf
from kokoro import KPipeline
import numpy as np

SEGS = {
  'fr': [
    ("intro",  "L'I.A. écrit du code en trois secondes. Qui le vérifie ? Personne."),
    ("code",   "Ton agent écrit ton backend à ta place. Vite."),
    ("strike", "Et là... il vient de supprimer ta garde d'authentification."),
    ("gate",   "SPARDA le bloque. À la seconde. Hors ligne."),
    ("prove",  "Puis il compile tout ton backend... et il le prouve."),
    ("outro",  "L'I.A. écrit. SPARDA prouve. Une seule commande."),
  ],
  'en': [
    ("intro",  "A.I. writes code in three seconds. Who checks it? Nobody."),
    ("code",   "Your agent writes your backend for you. Fast."),
    ("strike", "And right there... it just removed your auth guard."),
    ("gate",   "SPARDA blocks it. Instantly. Offline."),
    ("prove",  "Then it compiles your whole backend... and proves it."),
    ("outro",  "A.I. writes. SPARDA proves. One command."),
  ],
}
VOICES = {'fr': ('f', 'ff_siwis'), 'en': ('a', 'af_heart')}

for lang, (code, voice) in VOICES.items():
    pipe = KPipeline(lang_code=code, repo_id='hexgrad/Kokoro-82M')
    for name, text in SEGS[lang]:
        chunks = [audio for (_, _, audio) in pipe(text, voice=voice)]
        audio = np.concatenate(chunks)
        sf.write(f"public/vo/{lang}-{name}.wav", audio, 24000)
        print(lang, name, round(len(audio)/24000, 2), "s")
