const INVENTORY_FIELDS = [
  'professionalDocuments',
  'notifications',
  'privateMessages',
  'notificationDeliveries',
  'pushSubscriptions',
  'directoryBookings',
  'accountComplianceRecords',
  'organizations',
  'teamMemberships',
  'servicePartners',
  'liaisonLogs',
  'planningRecipients',
  'sharedNotes',
  'careVisits',
  'serviceBookings',
  'visitEvents',
  'visitEvaluations',
  'planningAccessAudits',
  'aiMessages',
  'wellbeingCheckins',
  'wellbeingCheckinShares'
];

function extractText(response) {
  if (typeof response.output_text === 'string' && response.output_text.trim()) {
    return response.output_text.trim();
  }
  return (response.output || [])
    .flatMap(item => item.content || [])
    .filter(item => item.type === 'output_text' && typeof item.text === 'string')
    .map(item => item.text)
    .join('\n')
    .trim();
}

async function reviewAccountClosure({ accountRole, accountTier, inventory, apiKey, model = 'gpt-4.1-mini' }) {
  if (!apiKey) {
    const error = new Error('L’analyse IA des demandes de clôture n’est pas configurée par l’équipe.');
    error.status = 503;
    throw error;
  }

  if (!inventory || typeof inventory !== 'object' || Array.isArray(inventory)) {
    throw new TypeError('L’inventaire des données liées au compte est invalide.');
  }
  const counts = Object.fromEntries(INVENTORY_FIELDS.map(field => {
    const value = inventory[field];
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new TypeError(`Le décompte de la catégorie ${field} est invalide.`);
    }
    return [field, value];
  }));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        store: false,
        max_output_tokens: 550,
        instructions: `Tu aides un administrateur à préparer l’examen d’une demande de clôture de compte d’une application française d’accompagnement. Produis un pré-jugement indicatif sur la complexité apparente du dossier, jamais une décision de suppression ou un avis juridique. Les catégories privateMessages, liaisonLogs, planningRecipients, sharedNotes, careVisits, serviceBookings, visitEvents, visitEvaluations, planningAccessAudits, organizations, teamMemberships, servicePartners et wellbeingCheckinShares concernent des données partagées ou des accès partagés ; wellbeingCheckins compte des réponses personnelles de bien-être. Les autres catégories sont des données de compte, de notifications, de réservation, de justificatifs professionnels ou de conversation. Classe le dossier comme "simple_to_review" seulement si aucun dossier partagé ni contrôle supplémentaire n’est signalé ; comme "shared_data_requires_review" si des éléments partagés sont présents ; comme "extra_checks_required" si le statut est premium ou en essai, des justificatifs professionnels existent, ou une vérification complémentaire s’impose. Les données fournies ne sont que le rôle, la catégorie de formule et des nombres de dossiers par catégorie ; elles ne contiennent ni identité, ni identifiant, ni texte de notes, de soins ou de bien-être. Ne déduis pas le contenu des dossiers à partir des nombres. Rédige une raison concise et une liste de vérifications utiles pour distinguer les données propres au compte des données partagées, vérifier les besoins d’autres personnes et les obligations de conservation, et documenter les suppressions ou motifs de conservation. Rappelle que l’administrateur vérifie les données dans l’application et prend seul la décision finale.`,
        text: {
          format: {
            type: 'json_schema',
            name: 'account_closure_pre_review',
            strict: true,
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                preliminaryJudgment: {
                  type: 'string',
                  enum: ['simple_to_review', 'shared_data_requires_review', 'extra_checks_required']
                },
                rationale: { type: 'string' },
                checks: {
                  type: 'array',
                  items: { type: 'string' }
                },
                administratorDecisionRequired: { type: 'boolean' }
              },
              required: ['preliminaryJudgment', 'rationale', 'checks', 'administratorDecisionRequired']
            }
          }
        },
        input: JSON.stringify({
          accountRole,
          accountTier,
          linkedRecordCounts: counts
        })
      })
    });

    if (!response.ok) {
      const error = new Error('Le service d’analyse IA des demandes de clôture est momentanément indisponible.');
      error.status = response.status === 429 ? 503 : 502;
      throw error;
    }

    const output = extractText(await response.json());
    let summary;
    try {
      summary = JSON.parse(output);
    } catch {
      const error = new Error('L’analyse IA n’a pas fourni un pré-jugement structuré exploitable.');
      error.status = 502;
      throw error;
    }
    if (!summary ||
        !['simple_to_review', 'shared_data_requires_review', 'extra_checks_required'].includes(summary.preliminaryJudgment) ||
        typeof summary.rationale !== 'string' || !summary.rationale.trim() || summary.rationale.length > 500 ||
        !Array.isArray(summary.checks) || summary.checks.length < 1 || summary.checks.length > 8 ||
        summary.checks.some(check => typeof check !== 'string' || !check.trim() || check.length > 240) ||
        summary.administratorDecisionRequired !== true) {
      const error = new Error('L’analyse IA n’a pas fourni de résumé exploitable.');
      error.status = 502;
      throw error;
    }
    return {
      preliminaryJudgment: summary.preliminaryJudgment,
      rationale: summary.rationale.trim(),
      checks: summary.checks.map(check => check.trim()),
      administratorDecisionRequired: true
    };
  } catch (error) {
    if (error.name === 'AbortError') {
      const timeoutError = new Error('L’analyse IA prend trop de temps. Réessayez.');
      timeoutError.status = 504;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { reviewAccountClosure };
