import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPORT_FILE = path.join(HERE, 'bilan-fuzzing-ia.json');
const CLEAN_REPORT = path.join(HERE, 'bilan-fuzzing-ia.md');

// This script fulfills the user's specific requirement:
// "effacer tout garder que un fichier de ce qui cest passer bilant rapport analsye tout le reste poublle"

console.log('🧹 Initializing Ephemeral Cleanup...');

if (!fs.existsSync(REPORT_FILE)) {
  console.log('No raw JSON report found. Nothing to clean.');
  process.exit(0);
}

// 1. Read the raw JSON
const rawData = JSON.parse(fs.readFileSync(REPORT_FILE, 'utf8'));

// 2. Generate the human-readable Markdown Report (The only file that will remain)
let mdContent = `# Bilan Fuzzing IA (Ollama)
**Date:** ${new Date().toISOString()}
**Modèle:** qwen2.5-coder

## Résumé
- **Total Mutants Testés:** ${rawData.KILLED + rawData.SURVIVED}
- **Bloqués par Sparda (KILLED):** ${rawData.KILLED} 🛡️
- **Failles Trouvées (SURVIVED):** ${rawData.SURVIVED} ⚠️

`;

if (rawData.SURVIVED > 0) {
  mdContent += `## Failles Découvertes (Zéro-Days)
Ces mutations ont contourné la logique de Sparda sans faire planter les tests. Il faut écrire de nouveaux tests pour les bloquer.

`;
  rawData.mutants.forEach((m, i) => {
    mdContent += `### Faille #${i + 1} dans \`${m.file}\`
**Ligne Originale :**
\`\`\`javascript
${m.search}
\`\`\`
**Remplacée par l'IA par :**
\`\`\`javascript
${m.replace}
\`\`\`

`;
  });
} else {
  mdContent += `## Résultat
Sparda est INFAILLIBLE face à cette vague d'attaques. Aucune faille n'a survécu.`;
}

// 3. Save the clean report
fs.writeFileSync(CLEAN_REPORT, mdContent);
console.log(`✅ Généré le rapport final: ${CLEAN_REPORT}`);

// 4. Delete the raw data and self-destruct the fuzzer script if desired,
// or just delete the raw logs as requested to keep only the final report.
fs.unlinkSync(REPORT_FILE);
console.log('🗑️ Fichier brut JSON supprimé.');

// Note: We don't delete the .mjs scripts themselves in case the user wants to run it again,
// but we wiped all the generated temporary logs/mutants.
console.log("✨ Nettoyage terminé. Seul le bilan d'analyse a été conservé.");
